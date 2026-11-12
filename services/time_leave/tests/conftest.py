import json
import sys
from datetime import datetime
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

SERVICE_DIR = Path(__file__).resolve().parents[1]
ROOT = SERVICE_DIR.parents[1]
sys.path.insert(0, str(ROOT / "shared" / "python"))
sys.path.insert(0, str(SERVICE_DIR))

TABLE_NAME = "hcm-time-leave-test"


@pytest.fixture(autouse=True)
def test_env(monkeypatch):
    # Credenciales falsas: moto intercepta las llamadas, nunca llegan a AWS.
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.setenv("TABLE_NAME", TABLE_NAME)
    monkeypatch.setenv("SERVICE_NAME", "time_leave")


@pytest.fixture(autouse=True)
def reset_clients(monkeypatch):
    """Los módulos cachean clientes entre invocaciones; en pruebas se limpian."""
    from common import db_dynamo, events

    monkeypatch.setattr(events, "_sns", None)
    monkeypatch.setattr(db_dynamo, "_resource", None)


def _gsi(name: str) -> dict:
    return {
        "IndexName": name,
        "KeySchema": [
            {"AttributeName": f"{name}PK", "KeyType": "HASH"},
            {"AttributeName": f"{name}SK", "KeyType": "RANGE"},
        ],
        "Projection": {"ProjectionType": "ALL"},
    }


@pytest.fixture(autouse=True)
def aws(test_env, monkeypatch):
    """Tabla con PK/SK + GSI1 + GSI2, y topic SNS con una cola SQS suscrita (como en AWS)."""
    with mock_aws():
        boto3.resource("dynamodb").create_table(
            TableName=TABLE_NAME,
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": n, "AttributeType": "S"}
                for n in ("PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK")
            ],
            GlobalSecondaryIndexes=[_gsi("GSI1"), _gsi("GSI2")],
            BillingMode="PAY_PER_REQUEST",
        )

        sns, sqs = boto3.client("sns"), boto3.client("sqs")
        topic_arn = sns.create_topic(Name="hcm-events")["TopicArn"]
        queue_url = sqs.create_queue(QueueName="test-q")["QueueUrl"]
        queue_arn = sqs.get_queue_attributes(QueueUrl=queue_url, AttributeNames=["QueueArn"])[
            "Attributes"
        ]["QueueArn"]
        sns.subscribe(
            TopicArn=topic_arn,
            Protocol="sqs",
            Endpoint=queue_arn,
            Attributes={"RawMessageDelivery": "true"},
        )
        monkeypatch.setenv("EVENTS_TOPIC_ARN", topic_arn)
        yield {"sqs": sqs, "queue_url": queue_url}


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
def at_lima(monkeypatch):
    """Fija la hora actual de Lima: at_lima('2026-11-12T08:58:00')."""
    from src import repository as repo

    def set_now(iso: str):
        fixed = datetime.fromisoformat(iso).replace(tzinfo=repo.LIMA)
        monkeypatch.setattr(repo, "now_lima", lambda: fixed)

    return set_now
