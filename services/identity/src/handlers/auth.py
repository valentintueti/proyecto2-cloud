"""Login y perfil del usuario autenticado."""
from common.auth import create_token
from common.db_dynamo import TenantTable
from common.http import handle_errors, not_found, ok, parse_body, require_fields, unauthorized
from common.tenant import get_auth_context, is_valid_tenant_id
from src import repository as repo
from src.passwords import hash_password, verify_password

INVALID = "Credenciales inválidas"
_dummy_hash = None


def _dummy():
    """Hash señuelo: un email inexistente tarda lo mismo que uno real."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password("dummy-password-para-timing")
    return _dummy_hash


@handle_errors
def login(event, context):
    body = require_fields(parse_body(event), "tenantId", "email", "password")
    tenant_id = str(body["tenantId"]).strip().lower()
    if not is_valid_tenant_id(tenant_id):
        return unauthorized(INVALID)
    try:
        sk = repo.user_sk(body["email"])
    except ValueError:
        return unauthorized(INVALID)

    user = TenantTable(tenant_id).get(sk)
    stored = user.get("passwordHash") if user else None
    password_ok = verify_password(body["password"], stored or _dummy())

    if not (user and stored and password_ok and user.get("status") == "ACTIVE"):
        return unauthorized(INVALID)

    token = create_token(user["userId"], tenant_id, user["role"])
    return ok({"token": token, "tokenType": "Bearer", "user": repo.public_user(user)})


@handle_errors
def me(event, context):
    ctx = get_auth_context(event)
    user = TenantTable(ctx["tenantId"]).get(repo.user_sk(ctx["userId"]))
    if not user:
        return not_found("Usuario no encontrado")
    return ok(repo.public_user(user))