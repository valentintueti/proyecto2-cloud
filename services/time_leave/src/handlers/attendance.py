"""Marcación de entrada/salida y consulta de asistencia."""
from common.db_dynamo import TenantTable
from common.http import ConflictError, created, handle_errors, ok, query_param
from common.tenant import get_auth_context, require_role
from src import repository as repo

MANAGERS = ("ADMIN_RRHH", "MANAGER")


def _attendance_of(tenant_id: str, email: str, event: dict) -> list:
    start, end = repo.parse_range(query_param(event, "from"), query_param(event, "to"))
    items, _ = TenantTable(tenant_id).query(repo.attendance_prefix(email))
    return [repo.public(i) for i in items if repo.in_range(i["date"], start, end)]


@handle_errors
def check_in(event, context):
    ctx = get_auth_context(event)
    email = repo.normalize_email(ctx["userId"])
    record = repo.new_check_in(email, repo.now_lima())
    try:
        saved = TenantTable(ctx["tenantId"]).put(
            repo.attendance_sk(email, record["date"]), record, if_not_exists=True,
        )
    except ConflictError:
        raise ConflictError("Ya marcaste tu entrada hoy")
    return created(repo.public(saved))


@handle_errors
def check_out(event, context):
    ctx = get_auth_context(event)
    email = repo.normalize_email(ctx["userId"])
    now = repo.now_lima()
    record = TenantTable(ctx["tenantId"]).get(repo.attendance_sk(email, now.date().isoformat()))
    if record is None:
        raise ValueError("Primero debes marcar tu entrada")
    if record.get("checkOut"):
        raise ConflictError("Ya marcaste tu salida hoy")
    return ok(repo.public(repo.set_check_out(ctx["tenantId"], record, now)))


@handle_errors
def my_attendance(event, context):
    ctx = get_auth_context(event)
    email = repo.normalize_email(ctx["userId"])
    return ok({"items": _attendance_of(ctx["tenantId"], email, event)})


@handle_errors
def list_attendance(event, context):
    ctx = require_role(event, *MANAGERS)
    raw_email = query_param(event, "email")
    if not raw_email:
        raise ValueError("Falta el parámetro email")
    email = repo.normalize_email(raw_email)
    return ok({"items": _attendance_of(ctx["tenantId"], email, event)})
