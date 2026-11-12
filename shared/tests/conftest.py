import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))


@pytest.fixture(autouse=True)
def test_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "secreto-de-pruebas-con-mas-de-32-caracteres")
    monkeypatch.setenv("JWT_EXPIRES_IN", "1h")
    # Credenciales falsas: moto intercepta las llamadas, nunca llegan a AWS.
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)


@pytest.fixture(autouse=True)
def reset_clients(monkeypatch):
    """Los módulos cachean clientes entre invocaciones; en pruebas se limpian."""
    from common import db_dynamo, db_pg, events

    monkeypatch.setattr(events, "_sns", None)
    monkeypatch.setattr(db_dynamo, "_resource", None)
    monkeypatch.setattr(db_pg, "_connections", {})


def api_event(tenant_id="acme", role="ADMIN_RRHH", user_id="u-1", body=None):
    """Simula un evento de API Gateway que ya pasó por el authorizer."""
    return {
        "requestContext": {"authorizer": {"tenantId": tenant_id, "role": role, "userId": user_id}},
        "body": body,
    }