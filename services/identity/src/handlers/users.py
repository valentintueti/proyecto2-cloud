from urllib.parse import unquote

from common.db_dynamo import TenantTable
from common.http import (
    created, get_limit, handle_errors, not_found, ok, parse_body,
    path_param, query_param, require_fields,
)
from common.tenant import require_role
from src import repository as repo

ADMIN = "ADMIN_RRHH"


@handle_errors
def list_users(event, context):
    ctx = require_role(event, ADMIN)
    items, next_cursor = TenantTable(ctx["tenantId"]).query(
        repo.USER_PREFIX, limit=get_limit(event), cursor=query_param(event, "cursor"),
    )
    return ok({"items": [repo.public_user(i) for i in items], "nextCursor": next_cursor})


@handle_errors
def create_user(event, context):
    ctx = require_role(event, ADMIN)
    body = require_fields(parse_body(event), "email", "name", "role", "password")
    user = repo.new_user(
        body["email"], body["name"], body["role"],
        password=body["password"], employee_id=body.get("employeeId"),
    )
    saved = TenantTable(ctx["tenantId"]).put(repo.user_sk(user["email"]), user, if_not_exists=True)
    return created(repo.public_user(saved))


@handle_errors
def update_user(event, context):
    ctx = require_role(event, ADMIN)
    email = repo.normalize_email(unquote(path_param(event, "email")))
    changes = repo.build_changes(parse_body(event))

    if email == ctx["userId"] and (
        changes.get("role", ADMIN) != ADMIN or changes.get("status", "ACTIVE") != "ACTIVE"
    ):
        raise ValueError("No puedes quitarte tu propio rol ni desactivarte")

    updated = TenantTable(ctx["tenantId"]).update(repo.user_sk(email), changes)
    if updated is None:
        return not_found("Usuario no encontrado")
    return ok(repo.public_user(updated))