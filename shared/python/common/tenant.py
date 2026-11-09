import re


TENANT_ID_PATTERN = re.compile(r"[a-z][a-z0-9_]{1,30}")


class TenantError(Exception):
    """No se pudo determinar un tenant válido para la request."""


def is_valid_tenant_id(tenant_id) -> bool:
    return isinstance(tenant_id, str) and TENANT_ID_PATTERN.fullmatch(tenant_id) is not None


def _require_valid(tenant_id: str) -> str:
    if not is_valid_tenant_id(tenant_id):
        raise TenantError(f"tenantId inválido: {tenant_id!r}")
    return tenant_id


def get_auth_context(event: dict) -> dict:
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    tenant_id = authorizer.get("tenantId")
    if not is_valid_tenant_id(tenant_id):
        raise TenantError("La request no trae un tenant válido en el contexto del authorizer")
    return {
        "tenantId": tenant_id,
        "userId": authorizer.get("userId"),
        "role": authorizer.get("role"),
    }


def get_tenant(event: dict) -> str:
    return get_auth_context(event)["tenantId"]


def require_role(event: dict, *allowed_roles: str) -> dict:
    ctx = get_auth_context(event)
    if ctx["role"] not in allowed_roles:
        raise PermissionError(f"El rol {ctx['role']!r} no puede realizar esta acción")
    return ctx


def schema_name(tenant_id: str) -> str:
    return f"tenant_{_require_valid(tenant_id)}"


def tenant_pk(tenant_id: str) -> str:
    return f"TENANT#{_require_valid(tenant_id)}"