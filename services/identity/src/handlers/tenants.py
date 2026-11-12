import hmac
import os

from common import events
from common.db_dynamo import TenantTable
from common.http import created, forbidden, handle_errors, parse_body, require_fields
from common.tenant import is_valid_tenant_id
from src import repository as repo


def _platform_key_ok(event) -> bool:
    expected = os.environ.get("PLATFORM_ADMIN_KEY", "")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    received = headers.get("x-platform-key") or ""
    return bool(expected) and hmac.compare_digest(received.encode(), expected.encode())


@handle_errors
def create(event, context):
    if not _platform_key_ok(event):
        return forbidden("Clave de plataforma inválida")

    body = require_fields(parse_body(event), "tenantId", "name", "adminEmail", "adminPassword")
    tenant_id = str(body["tenantId"]).strip().lower()
    if not is_valid_tenant_id(tenant_id):
        raise ValueError("tenantId debe cumplir [a-z][a-z0-9_]{1,30}")

    # Validar todo antes de escribir, para no dejar un tenant sin admin.
    admin = repo.new_user(
        body["adminEmail"], body.get("adminName") or "Administrador RRHH",
        "ADMIN_RRHH", password=body["adminPassword"],
    )
    profile = {
        "tenantId": tenant_id,
        "name": repo.clean_name(body["name"]),
        "plan": body.get("plan") or "standard",
        "status": "ACTIVE",
        "createdAt": repo.now_iso(),
    }

    table = TenantTable(tenant_id)
    saved_profile = table.put(repo.PROFILE_SK, profile, if_not_exists=True)  # 409 si ya existe
    saved_admin = table.put(repo.user_sk(admin["email"]), admin, if_not_exists=True)

    events.publish("TenantCreated", tenant_id, {
        "name": profile["name"], "plan": profile["plan"], "adminEmail": admin["email"],
    })
    return created({
        "tenant": repo.public_tenant(saved_profile),
        "admin": repo.public_user(saved_admin),
    })