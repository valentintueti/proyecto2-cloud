import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))


@pytest.fixture(autouse=True)
def jwt_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "secreto-de-pruebas-con-mas-de-32-caracteres")
    monkeypatch.setenv("JWT_EXPIRES_IN", "1h")


def api_event(tenant_id="acme", role="ADMIN_RRHH", user_id="u-1", body=None):
    """Simula un evento de API Gateway que ya pasó por el authorizer."""
    return {
        "requestContext": {"authorizer": {"tenantId": tenant_id, "role": role, "userId": user_id}},
        "body": body,
    }