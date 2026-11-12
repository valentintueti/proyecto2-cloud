"""Validación, armado de ítems y consultas de Time & Leave (asistencia, solicitudes y saldos)."""
import base64
import json
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from common.db_dynamo import TenantTable, get_table
from common.http import ConflictError
from common.tenant import tenant_pk

LIMA = ZoneInfo("America/Lima")

ATT_PREFIX = "ATT#"
LEAVE_PREFIX = "LEAVE#"
BALANCE_PREFIX = "BALANCE#"
GSI1 = "GSI1"  # solicitudes por empleado
GSI2 = "GSI2"  # solicitudes por estado

LEAVE_TYPES = ("VACATION", "SICK", "PERSONAL")
LEAVE_STATUSES = ("PENDING", "APPROVED", "REJECTED", "CANCELLED")
DEFAULT_VACATION_DAYS = 30
MAX_RANGE_DAYS = 366
MAX_REASON_LENGTH = 500
HIDDEN_FIELDS = {"PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK"}
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


# --- Utilidades -------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_lima() -> datetime:
    return datetime.now(LIMA).replace(microsecond=0)


def normalize_email(email) -> str:
    email = str(email or "").strip().lower()
    if len(email) > 254 or not _EMAIL.fullmatch(email):
        raise ValueError("email inválido")
    return email


def parse_date(value, field: str) -> date:
    value = str(value or "").strip()
    if not _DATE.fullmatch(value):
        raise ValueError(f"{field} debe tener formato YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} no es una fecha válida") from exc


def parse_range(date_from, date_to) -> tuple:
    """Rango opcional ?from=&to= como strings YYYY-MM-DD (o None)."""
    start = parse_date(date_from, "from").isoformat() if date_from else None
    end = parse_date(date_to, "to").isoformat() if date_to else None
    if start and end and end < start:
        raise ValueError("to debe ser mayor o igual a from")
    return start, end


def in_range(day: str, start, end) -> bool:
    return (start is None or day >= start) and (end is None or day <= end)


def business_days(start: date, end: date) -> int:
    """Días hábiles (lunes a viernes) entre start y end, ambos incluidos."""
    total = (end - start).days + 1
    return sum(1 for n in range(total) if (start + timedelta(days=n)).weekday() < 5)


def public(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in HIDDEN_FIELDS}


def _error_code(exc: ClientError) -> str:
    return exc.response["Error"]["Code"]


# --- Asistencia -------------------------------------------------------------

def attendance_prefix(email: str) -> str:
    return f"{ATT_PREFIX}{email}#"


def attendance_sk(email: str, day: str) -> str:
    return f"{attendance_prefix(email)}{day}"


def new_check_in(email: str, now: datetime) -> dict:
    return {"email": email, "date": now.date().isoformat(), "checkIn": now.isoformat()}


def worked_minutes(check_in: str, now: datetime) -> int:
    return max(0, int((now - datetime.fromisoformat(check_in)).total_seconds() // 60))


def set_check_out(tenant_id: str, record: dict, now: datetime) -> dict:
    """Marca la salida solo si aún no existe (evita dos check-out simultáneos)."""
    try:
        resp = get_table().update_item(
            Key={"PK": tenant_pk(tenant_id), "SK": record["SK"]},
            UpdateExpression="SET checkOut = :out, workedMinutes = :minutes",
            ConditionExpression="attribute_exists(PK) AND attribute_not_exists(checkOut)",
            ExpressionAttributeValues={
                ":out": now.isoformat(),
                ":minutes": worked_minutes(record["checkIn"], now),
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        if _error_code(exc) == "ConditionalCheckFailedException":
            raise ConflictError("Ya marcaste tu salida hoy")
        raise
    return resp["Attributes"]


# --- Solicitudes ------------------------------------------------------------

def leave_sk(request_id) -> str:
    return LEAVE_PREFIX + str(request_id)


def gsi1_pk(tenant_id: str, email: str) -> str:
    return f"{tenant_pk(tenant_id)}#EMP#{email}"


def gsi2_pk(tenant_id: str, status: str) -> str:
    return f"{tenant_pk(tenant_id)}#LEAVE#{status}"


def new_leave_request(tenant_id: str, email: str, body: dict) -> dict:
    leave_type = body.get("type")
    if leave_type not in LEAVE_TYPES:
        raise ValueError(f"type debe ser uno de {list(LEAVE_TYPES)}")
    start = parse_date(body.get("startDate"), "startDate")
    end = parse_date(body.get("endDate"), "endDate")
    if end < start:
        raise ValueError("endDate debe ser mayor o igual a startDate")
    if (end - start).days >= MAX_RANGE_DAYS:
        raise ValueError("El rango no puede superar un año")
    days = business_days(start, end)
    if days == 0:
        raise ValueError("El rango no incluye días hábiles")
    reason = str(body.get("reason") or "").strip()
    if len(reason) > MAX_REASON_LENGTH:
        raise ValueError(f"reason no puede superar {MAX_REASON_LENGTH} caracteres")

    request_id = str(uuid.uuid4())
    return {
        "GSI1PK": gsi1_pk(tenant_id, email),
        "GSI1SK": f"{LEAVE_PREFIX}{start.isoformat()}",
        "GSI2PK": gsi2_pk(tenant_id, "PENDING"),
        "GSI2SK": f"{start.isoformat()}#{request_id}",
        "requestId": request_id,
        "email": email,
        "type": leave_type,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "days": days,
        "reason": reason,
        "status": "PENDING",
        "createdAt": now_iso(),
    }


def request_year(request: dict) -> int:
    """El saldo que consume una solicitud es el del año de startDate."""
    return int(str(request["startDate"])[:4])


def _decision_update(tenant_id: str, status: str, actor: str, at: str) -> dict:
    """PENDING -> status, actualizando también GSI2PK."""
    return {
        "UpdateExpression": "SET #st = :status, GSI2PK = :gsi2pk, decidedBy = :by, decidedAt = :at",
        "ConditionExpression": "#st = :pending",
        "ExpressionAttributeNames": {"#st": "status"},
        "ExpressionAttributeValues": {
            ":status": status,
            ":gsi2pk": gsi2_pk(tenant_id, status),
            ":by": actor,
            ":at": at,
            ":pending": "PENDING",
        },
    }


def decide(tenant_id: str, request_id: str, status: str, actor: str) -> dict:
    """Cambia el estado de una solicitud PENDING. 409 si ya no está PENDING."""
    try:
        resp = get_table().update_item(
            Key={"PK": tenant_pk(tenant_id), "SK": leave_sk(request_id)},
            ReturnValues="ALL_NEW",
            **_decision_update(tenant_id, status, actor, now_iso()),
        )
    except ClientError as exc:
        if _error_code(exc) == "ConditionalCheckFailedException":
            raise ConflictError("La solicitud ya no está pendiente")
        raise
    return resp["Attributes"]


def approve_vacation(tenant_id: str, request: dict, approver: str) -> dict:
    """Aprueba la solicitud y descuenta el saldo en una sola transacción.

    DynamoDB no admite aritmética en ConditionExpression, así que
    `usedDays + :days <= vacationDays` se expresa como
    `vacationDays = :vacation AND usedDays <= :maxUsed` con :maxUsed = vacationDays - days.
    Si otra aprobación cambió usedDays antes, la condición falla y se devuelve 409.
    """
    table = TenantTable(tenant_id)
    email, days = request["email"], int(request["days"])
    balance = ensure_balance(table, email, request_year(request))
    vacation = int(balance["vacationDays"])
    if days > available_days(balance):
        raise ConflictError("Saldo de vacaciones insuficiente")

    at = now_iso()
    try:
        table.table.meta.client.transact_write_items(TransactItems=[
            {"Update": {
                "TableName": table.table.name,
                "Key": {"PK": table.pk, "SK": leave_sk(request["requestId"])},
                **_decision_update(tenant_id, "APPROVED", approver, at),
            }},
            {"Update": {
                "TableName": table.table.name,
                "Key": {"PK": table.pk, "SK": balance_sk(email, request_year(request))},
                "UpdateExpression": "SET usedDays = usedDays + :days",
                "ConditionExpression": "vacationDays = :vacation AND usedDays <= :maxUsed",
                "ExpressionAttributeValues": {
                    ":days": days,
                    ":vacation": vacation,
                    ":maxUsed": vacation - days,
                },
            }},
        ])
    except ClientError as exc:
        if _error_code(exc) == "TransactionCanceledException":
            raise ConflictError(
                "No se pudo aprobar: la solicitud ya no está pendiente o el saldo no alcanza"
            )
        raise
    return {
        **request,
        "status": "APPROVED",
        "GSI2PK": gsi2_pk(tenant_id, "APPROVED"),
        "decidedBy": approver,
        "decidedAt": at,
    }


def leave_approved_data(request: dict) -> dict:
    """`data` del evento LeaveApproved (contrato del README)."""
    return {
        "requestId": request["requestId"],
        "email": request["email"],
        "type": request["type"],
        "startDate": request["startDate"],
        "endDate": request["endDate"],
        "days": int(request["days"]),
        "approvedBy": request["decidedBy"],
    }


# --- Consultas a GSIs (TenantTable no las soporta) ----------------------------

def query_by_employee(tenant_id: str, email: str, *, limit=None, cursor=None):
    pk = gsi1_pk(tenant_id, email)
    return _query_index(tenant_id, GSI1, "GSI1PK", pk, limit=limit, cursor=cursor, forward=False)


def query_by_status(tenant_id: str, status: str, *, limit=None, cursor=None):
    if status not in LEAVE_STATUSES:
        raise ValueError(f"status debe ser uno de {list(LEAVE_STATUSES)}")
    pk = gsi2_pk(tenant_id, status)
    return _query_index(tenant_id, GSI2, "GSI2PK", pk, limit=limit, cursor=cursor, forward=True)


def _query_index(tenant_id, index, pk_name, pk_value, *, limit, cursor, forward):
    """Devuelve (items, next_cursor). La PK del índice siempre sale de tenant_pk(tenant_id)."""
    kwargs = {
        "IndexName": index,
        "KeyConditionExpression": Key(pk_name).eq(pk_value),
        "ScanIndexForward": forward,
    }
    if limit:
        kwargs["Limit"] = limit
    if cursor:
        kwargs["ExclusiveStartKey"] = _decode_cursor(
            cursor, {"PK": tenant_pk(tenant_id), pk_name: pk_value}
        )
    resp = get_table().query(**kwargs)
    last_key = resp.get("LastEvaluatedKey")
    return resp.get("Items", []), _encode_cursor(last_key) if last_key else None


def _encode_cursor(last_key: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(last_key).encode()).decode()


def _decode_cursor(cursor: str, expected: dict) -> dict:
    try:
        key = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except ValueError as exc:
        raise ValueError("Cursor de paginación inválido") from exc
    # Evita que un tenant use un cursor para saltar a la partición de otro.
    if not isinstance(key, dict) or any(key.get(k) != v for k, v in expected.items()):
        raise ValueError("Cursor de paginación inválido")
    return key


# --- Saldos -----------------------------------------------------------------

def balance_sk(email: str, year) -> str:
    return f"{BALANCE_PREFIX}{email}#{int(year)}"


def default_balance(email: str, year) -> dict:
    return {"email": email, "year": int(year), "vacationDays": DEFAULT_VACATION_DAYS, "usedDays": 0}


def available_days(balance: dict) -> int:
    return int(balance["vacationDays"]) - int(balance["usedDays"])


def public_balance(balance: dict) -> dict:
    return {**public(balance), "availableDays": available_days(balance)}


def get_balance(table: TenantTable, email: str, year) -> dict:
    """Saldo del año; si no existe devuelve el de 30 días SIN escribirlo."""
    return table.get(balance_sk(email, year)) or default_balance(email, year)


def ensure_balance(table: TenantTable, email: str, year) -> dict:
    """Saldo del año; si no existe lo crea con 30 días."""
    sk = balance_sk(email, year)
    existing = table.get(sk)
    if existing:
        return existing
    try:
        return table.put(sk, default_balance(email, year), if_not_exists=True)
    except ConflictError:
        return table.get(sk)  # otro request lo creó al mismo tiempo
