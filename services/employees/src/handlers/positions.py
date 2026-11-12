"""API de puestos."""
from common import db_pg
from common.http import created, handle_errors, ok, parse_body, query_param
from common.tenant import require_role
from src import repository as repo
from src import schemas as s


@handle_errors
def list_positions(event, context):
    ctx = require_role(event, *s.ALL_ROLES)
    raw = query_param(event, "departmentId")
    department_id = s.parse_uuid(raw, "departmentId") if raw else None
    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        rows = repo.list_positions(conn, department_id)
    return ok({"items": [s.to_api(r) for r in rows]})


@handle_errors
def create_position(event, context):
    ctx = require_role(event, s.ADMIN)
    data = s.new_position(parse_body(event))
    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        row = repo.insert_position(conn, data)
    return created(s.to_api(row))