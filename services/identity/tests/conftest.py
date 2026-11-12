import json
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "shared" / "python"))
sys.path.insert(0, str(ROOT / "services" / "identity"))

TABLE = "hcm-identity-test"
PLATFORM_KEY = "platform-test-key"


@pytest.fixture(autouse=True)
def aws(monkeypatch):
    for k, v in {
        "AWS_ACCESS_KEY_ID": "testing", "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing", "AWS_DEFAULT_REGION": "us-east-1",
        "JWT_SECRET": "test-secret-de-al-menos-32-caracteres-123",
        "JWT_EXPIRES_IN": "1h", "TABLE_NAME": TABLE, "SERVICE_NAME": "identity",
        "PLATFORM_ADMIN_KEY": PLATFORM_KEY, "PASSWORD_ITERATIONS": "1000",
    }.items():
        monkeypatch.setenv(k, v)

    from common import db_dynamo, events
    monkeypatch.setattr(db_dynamo, "_resource", None)
    monkeypatch.setattr(events, "_sns", None)

    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName=TABLE, BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"},
                                  {"AttributeName": "SK", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"},
                       {"AttributeName": "SK", "KeyType": "RANGE"}],
        )
        sns, sqs = boto3.client("sns"), boto3.client("sqs")
        topic = sns.create_topic(Name="hcm-events")["TopicArn"]
        queue_url = sqs.create_queue(QueueName="spy")["QueueUrl"]
        queue_arn = sqs.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
        sns.subscribe(TopicArn=topic, Protocol="sqs", Endpoint=queue_arn,
                      Attributes={"RawMessageDelivery": "true"})
        monkeypatch.setenv("EVENTS_TOPIC_ARN", topic)
        yield {"sqs": sqs, "queue_url": queue_url}


def _event(body=None, auth=None, path=None, query=None, headers=None):
    return {
        "headers": headers or {},
        "pathParameters": path,
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": auth} if auth else {},
    }


@pytest.fixture
def make_event():
    return _event


@pytest.fixture
def published(aws):
    def read():
        resp = aws["sqs"].receive_message(QueueUrl=aws["queue_url"], MaxNumberOfMessages=10)
        return [json.loads(m["Body"]) for m in resp.get("Messages", [])]
    return read


@pytest.fixture
def create_tenant():
    from src.handlers import tenants

    def _create(tenant_id="acme", admin_email=None, password="Secreta123"):
        admin_email = admin_email or f"admin@{tenant_id}.com"
        resp = tenants.create(_event(
            body={"tenantId": tenant_id, "name": tenant_id.title(),
                  "adminEmail": admin_email, "adminPassword": password},
            headers={"X-Platform-Key": PLATFORM_KEY},
        ), None)
        assert resp["statusCode"] == 201, resp["body"]
        return {"tenantId": tenant_id, "userId": admin_email, "role": "ADMIN_RRHH"}
    return _create


@pytest.fixture
def admin(create_tenant):
    return create_tenant("acme")