"""API de departamentos."""
from common import db_pg
from common.http import created, handle_errors, ok, parse_body
from common.tenant import require_role
from src import repository as repo
from src import schemas as s


@handle_errors
def list_departments(event, context):
    ctx = require_role(event, *s.ALL_ROLES)
    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        rows = repo.list_departments(conn)
    return ok({"items": [s.to_api(r) for r in rows]})


@handle_errors
def create_department(event, context):
    ctx = require_role(event, s.ADMIN)
    data = s.new_department(parse_body(event))
    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        row = repo.insert_department(conn, data)
    return created(s.to_api(row))