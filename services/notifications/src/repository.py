"""Validación, armado de ítems y consultas de la bandeja de notificaciones."""
import base64
import json
import re
import uuid
from datetime import datetime, timezone

from boto3.dynamodb.conditions import Attr, Key

from common.db_dynamo import TenantTable, get_table
from common.tenant import tenant_pk

NOTIF_PREFIX = "NOTIF#"
TYPES = ("WELCOME", "NEW_TEAM_MEMBER", "LEAVE_APPROVED", "PAYSLIP_READY")
HIDDEN_FIELDS = {"PK", "SK"}
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_ID_NAMESPACE = uuid.UUID("6f1c7a52-3b1e-4c8e-9a4d-2f0b8e5d7c11")


# --- Utilidades -------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_email(email) -> str:
    email = str(email or "").strip().lower()
    if len(email) > 254 or not _EMAIL.fullmatch(email):
        raise ValueError("email inválido")
    return email


def to_utc_z(value) -> str:
    """'2026-11-20T10:04:05-05:00' -> '2026-11-20T15:04:05Z'. Sin valor usa la hora actual."""
    if not value:
        dt = datetime.now(timezone.utc)
    else:
        try:
            dt = datetime.fromisoformat(str(value))
        except ValueError as exc:
            raise ValueError("Fecha ISO-8601 inválida") from exc
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_bool(value, field: str) -> bool:
    if value in (None, ""):
        return False
    value = str(value).strip().lower()
    if value in ("true", "1"):
        return True
    if value in ("false", "0"):
        return False
    raise ValueError(f"{field} debe ser true o false")


def validate_notification_id(value) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError as exc:
        raise ValueError("notificationId inválido") from exc


def public(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in HIDDEN_FIELDS}


# --- Armado de ítems --------------------------------------------------------

def user_prefix(email: str) -> str:
    return f"{NOTIF_PREFIX}{email}#"


def notification_id(source_event_id: str, notif_type: str, email: str) -> str:
    """Determinístico: el mismo evento siempre produce el mismo id (idempotencia)."""
    return str(uuid.uuid5(_ID_NAMESPACE, f"{source_event_id}|{notif_type}|{email}"))


def notification_sk(email: str, created_at: str, notif_id: str) -> str:
    return f"{user_prefix(email)}{created_at}#{notif_id}"


def new_notification(draft: dict, source_event_id: str, occurred_at) -> tuple:
    """(sk, item) a partir de un borrador de messages.build(...)."""
    if draft["type"] not in TYPES:
        raise ValueError(f"type debe ser uno de {list(TYPES)}")
    if not source_event_id:
        raise ValueError("Falta el eventId del evento")
    email = normalize_email(draft["email"])
    created_at = to_utc_z(occurred_at)
    notif_id = notification_id(source_event_id, draft["type"], email)
    item = {
        "notificationId": notif_id,
        "email": email,
        "type": draft["type"],
        "title": draft["title"],
        "message": draft["message"],
        "link": draft["link"],
        "read": False,
        "sourceEventId": source_event_id,
        "createdAt": created_at,
    }
    return notification_sk(email, created_at, notif_id), item


# --- Consultas --------------------------------------------------------------
# TenantTable.query no permite orden descendente ni filtros, por eso estas
# consultas usan get_table() siempre con PK = tenant_pk(tenant_id) y el prefijo del usuario.

def _base_query(tenant_id: str, email: str) -> dict:
    return {
        "KeyConditionExpression": Key("PK").eq(tenant_pk(tenant_id))
        & Key("SK").begins_with(user_prefix(email)),
        "ScanIndexForward": False,  # más recientes primero
    }


def query_user(tenant_id: str, email: str, *, limit=None, cursor=None, unread_only=False):
    """Devuelve (items, next_cursor) de la bandeja del usuario."""
    kwargs = _base_query(tenant_id, email)
    if unread_only:
        kwargs["FilterExpression"] = Attr("read").eq(False)
    if limit:
        kwargs["Limit"] = limit
    if cursor:
        kwargs["ExclusiveStartKey"] = _decode_cursor(cursor, tenant_id, email)
    resp = get_table().query(**kwargs)
    last_key = resp.get("LastEvaluatedKey")
    return resp.get("Items", []), _encode_cursor(last_key) if last_key else None


def _pages(tenant_id: str, email: str, **extra):
    """Recorre todas las páginas de la bandeja del usuario."""
    kwargs = {**_base_query(tenant_id, email), **extra}
    table = get_table()
    while True:
        resp = table.query(**kwargs)
        yield resp
        if "LastEvaluatedKey" not in resp:
            return
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def find_by_id(tenant_id: str, email: str, notif_id: str):
    """Busca solo dentro de la bandeja del usuario: una notificación ajena da None (404)."""
    for resp in _pages(tenant_id, email, FilterExpression=Attr("notificationId").eq(notif_id)):
        if resp.get("Items"):
            return resp["Items"][0]
    return None


def count_unread(tenant_id: str, email: str) -> int:
    return sum(
        resp["Count"]
        for resp in _pages(tenant_id, email, FilterExpression=Attr("read").eq(False), Select="COUNT")
    )


def mark_read(tenant_id: str, item: dict) -> dict:
    if item.get("read"):
        return item
    updated = TenantTable(tenant_id).update(item["SK"], {"read": True, "readAt": now_iso()})
    return updated or item


def mark_all_read(tenant_id: str, email: str) -> int:
    table = TenantTable(tenant_id)
    read_at = now_iso()
    unread_sks = [
        item["SK"]
        for resp in _pages(tenant_id, email, FilterExpression=Attr("read").eq(False), ProjectionExpression="SK")
        for item in resp.get("Items", [])
    ]
    for sk in unread_sks:
        table.update(sk, {"read": True, "readAt": read_at})
    return len(unread_sks)


def _encode_cursor(last_key: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(last_key).encode()).decode()


def _decode_cursor(cursor: str, tenant_id: str, email: str) -> dict:
    try:
        key = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except ValueError as exc:
        raise ValueError("Cursor de paginación inválido") from exc
    # El cursor no puede apuntar a otro tenant ni a la bandeja de otro usuario.
    if (
        not isinstance(key, dict)
        or key.get("PK") != tenant_pk(tenant_id)
        or not str(key.get("SK", "")).startswith(user_prefix(email))
    ):
        raise ValueError("Cursor de paginación inválido")
    return key
