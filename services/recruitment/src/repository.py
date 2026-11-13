"""Validación, armado de ítems y operaciones de Recruitment (vacantes y postulaciones)."""
import re
import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from botocore.exceptions import ClientError

from common.db_dynamo import TenantTable, get_table
from common.http import ConflictError
from common.tenant import tenant_pk

LIMA = ZoneInfo("America/Lima")

JOB_PREFIX = "JOB#"
APP_PREFIX = "APP#"

JOB_STATUSES = ("OPEN", "CLOSED")
STAGES = ("APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED")
# Avance lineal; desde cualquier etapa (menos HIRED y REJECTED) se puede pasar a REJECTED.
NEXT_STAGE = {
    "APPLIED": "SCREENING",
    "SCREENING": "INTERVIEW",
    "INTERVIEW": "OFFER",
    "OFFER": "HIRED",
}
CV_CONTENT_TYPE = "application/pdf"

MAX_TITLE = 150
MAX_TEXT = 5000
MAX_NAME = 100
MAX_NOTES = 2000
MAX_OPENINGS = 1000
JOB_EDITABLE = ("title", "departmentId", "description", "location", "openings", "status")
HIDDEN_FIELDS = {"PK", "SK", "tenantId"}

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_PHONE = re.compile(r"\+?[0-9 ()-]{6,20}")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


# --- Utilidades -------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_lima() -> date:
    return datetime.now(LIMA).date()


def public(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in HIDDEN_FIELDS}


def normalize_email(email) -> str:
    email = str(email or "").strip().lower()
    if len(email) > 254 or not _EMAIL.fullmatch(email):
        raise ValueError("email inválido")
    return email


def _text(value, field: str, max_length: int, *, required: bool = False) -> str:
    if value is not None and not isinstance(value, str):
        raise ValueError(f"{field} debe ser texto")
    value = (value or "").strip()
    if required and not value:
        raise ValueError(f"{field} es obligatorio")
    if len(value) > max_length:
        raise ValueError(f"{field} no puede superar {max_length} caracteres")
    return value


def _uuid(value, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError(f"{field} debe ser un UUID") from exc


def _openings(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("openings debe ser un entero")
    if not 1 <= value <= MAX_OPENINGS:
        raise ValueError(f"openings debe estar entre 1 y {MAX_OPENINGS}")
    return value


def _job_status(value) -> str:
    if value not in JOB_STATUSES:
        raise ValueError(f"status debe ser uno de {list(JOB_STATUSES)}")
    return value


def _error_code(exc: ClientError) -> str:
    return exc.response["Error"]["Code"]


# --- Vacantes ---------------------------------------------------------------

def job_sk(job_id) -> str:
    return JOB_PREFIX + str(job_id)


def new_job(body: dict, created_by: str) -> dict:
    now = now_iso()
    job = {
        "jobId": str(uuid.uuid4()),
        "title": _text(body.get("title"), "title", MAX_TITLE, required=True),
        "description": _text(body.get("description"), "description", MAX_TEXT),
        "location": _text(body.get("location"), "location", MAX_NAME),
        "openings": _openings(body.get("openings", 1)),
        "status": _job_status(body.get("status", "OPEN")),
        "createdBy": created_by,
        "createdAt": now,
        "updatedAt": now,
    }
    if body.get("departmentId"):
        job["departmentId"] = _uuid(body["departmentId"], "departmentId")
    return job


def job_changes(body: dict) -> dict:
    """Valida los campos editables de una vacante. Ignora los que no se pueden editar."""
    changes = {}
    if "title" in body:
        changes["title"] = _text(body["title"], "title", MAX_TITLE, required=True)
    if "description" in body:
        changes["description"] = _text(body["description"], "description", MAX_TEXT)
    if "location" in body:
        changes["location"] = _text(body["location"], "location", MAX_NAME)
    if "openings" in body:
        changes["openings"] = _openings(body["openings"])
    if "status" in body:
        changes["status"] = _job_status(body["status"])
    if "departmentId" in body:
        changes["departmentId"] = _uuid(body["departmentId"], "departmentId") if body["departmentId"] else None
    if not changes:
        raise ValueError(f"No hay campos para actualizar. Editables: {list(JOB_EDITABLE)}")
    changes["updatedAt"] = now_iso()
    return changes


def list_jobs(table: TenantTable, status=None, *, limit=None, cursor=None):
    """Vacantes del tenant (paginadas). El filtro por estado se aplica sobre cada página."""
    if status is not None:
        _job_status(status)
    items, next_cursor = table.query(JOB_PREFIX, limit=limit, cursor=cursor)
    if status:
        items = [i for i in items if i.get("status") == status]
    return items, next_cursor


# --- Postulaciones ------------------------------------------------------------

def applications_prefix(job_id) -> str:
    return f"{APP_PREFIX}{job_id}#"


def application_sk(job_id, application_id) -> str:
    return f"{applications_prefix(job_id)}{application_id}"


def new_application(job_id: str, body: dict) -> dict:
    phone = _text(body.get("phone"), "phone", 20)
    if phone and not _PHONE.fullmatch(phone):
        raise ValueError("phone inválido")
    now = now_iso()
    return {
        "applicationId": str(uuid.uuid4()),
        "jobId": job_id,
        "firstName": _text(body.get("firstName"), "firstName", MAX_NAME, required=True),
        "lastName": _text(body.get("lastName"), "lastName", MAX_NAME, required=True),
        "email": normalize_email(body.get("email")),
        "phone": phone,
        "stage": "APPLIED",
        "cvKey": None,
        "notes": parse_notes(body.get("notes")),
        "createdAt": now,
        "updatedAt": now,
    }


def email_already_applied(table: TenantTable, job_id: str, email: str) -> bool:
    cursor = None
    while True:
        items, cursor = table.query(applications_prefix(job_id), cursor=cursor)
        if any(i.get("email") == email for i in items):
            return True
        if not cursor:
            return False


def parse_notes(value) -> str:
    return _text(value, "notes", MAX_NOTES)


def check_transition(current: str, target) -> str:
    """Valida el cambio de etapa. Una transición inválida es ValueError (400)."""
    if target not in STAGES:
        raise ValueError(f"stage debe ser uno de {list(STAGES)}")
    if target == "REJECTED" and current not in ("HIRED", "REJECTED"):
        return target
    if NEXT_STAGE.get(current) == target:
        return target
    raise ValueError(f"Transición inválida: {current} -> {target}")


def _stage_update(application: dict, target: str, notes, at: str) -> dict:
    """Update condicionado a que la etapa no haya cambiado desde que se leyó."""
    names = {"#stage": "stage"}
    values = {":stage": target, ":current": application["stage"], ":at": at}
    expression = "SET #stage = :stage, updatedAt = :at"
    if notes is not None:
        expression += ", notes = :notes"
        values[":notes"] = notes
    return {
        "UpdateExpression": expression,
        "ConditionExpression": "attribute_exists(PK) AND #stage = :current",
        "ExpressionAttributeNames": names,
        "ExpressionAttributeValues": values,
    }


def change_stage(tenant_id: str, application: dict, target: str, notes) -> dict:
    """Cambia la etapa (no HIRED). 409 si otro request la cambió antes."""
    try:
        resp = get_table().update_item(
            Key={"PK": tenant_pk(tenant_id), "SK": application_sk(application["jobId"], application["applicationId"])},
            ReturnValues="ALL_NEW",
            **_stage_update(application, target, notes, now_iso()),
        )
    except ClientError as exc:
        if _error_code(exc) == "ConditionalCheckFailedException":
            raise ConflictError("La postulación cambió de etapa; vuelve a intentarlo")
        raise
    return resp["Attributes"]


def hire(tenant_id: str, application: dict, job: dict, notes) -> tuple:
    """Pasa la postulación a HIRED y descuenta 1 vacante en una sola transacción.

    Si `openings` llega a 0 la vacante pasa a CLOSED. Ambas escrituras están
    condicionadas a lo leído, así que dos contrataciones simultáneas no dejan
    `openings` negativo (409). Devuelve (postulación, vacante) actualizadas.
    """
    openings = int(job.get("openings") or 0)
    if job.get("status") != "OPEN" or openings < 1:
        raise ConflictError("La vacante no tiene puestos disponibles")

    table = TenantTable(tenant_id)
    at = now_iso()
    remaining = openings - 1
    new_status = "CLOSED" if remaining == 0 else "OPEN"
    try:
        table.table.meta.client.transact_write_items(TransactItems=[
            {"Update": {
                "TableName": table.table.name,
                "Key": {"PK": table.pk, "SK": application_sk(application["jobId"], application["applicationId"])},
                **_stage_update(application, "HIRED", notes, at),
            }},
            {"Update": {
                "TableName": table.table.name,
                "Key": {"PK": table.pk, "SK": job_sk(job["jobId"])},
                "UpdateExpression": "SET openings = :remaining, #st = :status, updatedAt = :at",
                "ConditionExpression": "attribute_exists(PK) AND openings = :openings AND #st = :open",
                "ExpressionAttributeNames": {"#st": "status"},
                "ExpressionAttributeValues": {
                    ":remaining": remaining,
                    ":status": new_status,
                    ":openings": openings,
                    ":open": "OPEN",
                    ":at": at,
                },
            }},
        ])
    except ClientError as exc:
        if _error_code(exc) == "TransactionCanceledException":
            raise ConflictError("No se pudo contratar: la postulación o la vacante cambiaron")
        raise

    hired = {**application, "stage": "HIRED", "updatedAt": at}
    if notes is not None:
        hired["notes"] = notes
    return hired, {**job, "openings": remaining, "status": new_status, "updatedAt": at}


def hire_details(body: dict) -> dict:
    """Datos opcionales que acompañan el paso a HIRED: startDate (default hoy en Lima) y salary."""
    start = body.get("startDate")
    if start:
        start = str(start).strip()
        if not _DATE.fullmatch(start):
            raise ValueError("startDate debe tener formato YYYY-MM-DD")
        try:
            start = date.fromisoformat(start).isoformat()
        except ValueError as exc:
            raise ValueError("startDate no es una fecha válida") from exc
    else:
        start = today_lima().isoformat()

    salary = body.get("salary")
    if salary is not None:
        if isinstance(salary, bool) or not isinstance(salary, (int, float)) or salary < 0:
            raise ValueError("salary debe ser un número mayor o igual a 0")
    return {"startDate": start, "salary": salary}


def candidate_hired_data(application: dict, job: dict, details: dict) -> dict:
    """`data` del evento CandidateHired (contrato del README)."""
    data = {
        "applicationId": application["applicationId"],
        "jobId": application["jobId"],
        "email": application["email"],
        "firstName": application["firstName"],
        "lastName": application["lastName"],
        "positionTitle": job["title"],
        "startDate": details["startDate"],
    }
    if job.get("departmentId"):
        data["departmentId"] = job["departmentId"]
    if details.get("salary") is not None:
        data["salary"] = details["salary"]
    return data
