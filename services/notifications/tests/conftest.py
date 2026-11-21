import json
import sys
import uuid
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

SERVICE_DIR = Path(__file__).resolve().parents[1]
ROOT = SERVICE_DIR.parents[1]
sys.path.insert(0, str(ROOT / "shared" / "python"))
sys.path.insert(0, str(SERVICE_DIR))

TABLE_NAME = "hcm-notifications-test"
SENDER = "no-reply@hcm.test"


@pytest.fixture(autouse=True)
def test_env(monkeypatch):
    # Credenciales falsas: moto intercepta las llamadas, nunca llegan a AWS.
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.setenv("TABLE_NAME", TABLE_NAME)
    monkeypatch.setenv("SERVICE_NAME", "notifications")
    monkeypatch.setenv("EMAIL_ENABLED", "false")
    monkeypatch.setenv("EMAIL_SENDER", SENDER)


@pytest.fixture(autouse=True)
def reset_clients(monkeypatch):
    """Los módulos cachean clientes entre invocaciones; en pruebas se limpian."""
    from common import db_dynamo, events
    from src.handlers import on_event

    monkeypatch.setattr(events, "_sns", None)
    monkeypatch.setattr(db_dynamo, "_resource", None)
    monkeypatch.setattr(on_event, "_ses", None)


@pytest.fixture(autouse=True)
def aws(test_env):
    """Tabla con PK/SK (sin GSIs) y SES simulado."""
    with mock_aws():
        boto3.resource("dynamodb").create_table(
            TableName=TABLE_NAME,
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield {"ses": boto3.client("ses")}


@pytest.fixture
def api_event():
    """Simula un evento de API Gateway que ya pasó por el authorizer."""

    def build(tenant_id="acme", role="EMPLOYEE", user_id="ana@acme.com",
              body=None, path=None, query=None):
        return {
            "requestContext": {
                "authorizer": {"tenantId": tenant_id, "role": role, "userId": user_id}
            },
            "body": json.dumps(body) if body is not None else None,
            "pathParameters": path,
            "queryStringParameters": query,
        }

    return build


@pytest.fixture
def sqs_event():
    """Lote SQS con un evento del sistema (sobre común de common.events)."""

    def build(event_type, data, *, tenant_id="acme", event_id=None,
              occurred_at="2026-11-20T15:04:05+00:00"):
        envelope = {
            "eventId": event_id or str(uuid.uuid4()),
            "eventType": event_type,
            "tenantId": tenant_id,
            "source": "test",
            "occurredAt": occurred_at,
            "data": data,
        }
        return {"Records": [{"messageId": "m-1", "body": json.dumps(envelope)}]}

    return build


@pytest.fixture
def notify(sqs_event):
    """Crea una notificación LEAVE_APPROVED para `email` pasando por el consumidor."""
    from src.handlers import on_event

    def create(email="ana@acme.com", *, tenant_id="acme", occurred_at="2026-11-20T15:04:05+00:00"):
        data = {
            "requestId": str(uuid.uuid4()), "email": email, "type": "VACATION",
            "startDate": "2026-12-07", "endDate": "2026-12-11", "days": 5,
            "approvedBy": "jefe@acme.com",
        }
        result = on_event.handler(
            sqs_event("LeaveApproved", data, tenant_id=tenant_id, occurred_at=occurred_at), None,
        )
        assert result == {"batchItemFailures": []}

    return create
