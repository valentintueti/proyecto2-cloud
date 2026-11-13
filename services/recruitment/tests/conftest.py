import json
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

SERVICE_DIR = Path(__file__).resolve().parents[1]
ROOT = SERVICE_DIR.parents[1]
sys.path.insert(0, str(ROOT / "shared" / "python"))
sys.path.insert(0, str(SERVICE_DIR))

TABLE_NAME = "hcm-recruitment-test"
BUCKET_NAME = "hcm-recruitment-test"


@pytest.fixture(autouse=True)
def test_env(monkeypatch):
    # Credenciales falsas: moto intercepta las llamadas, nunca llegan a AWS.
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.setenv("TABLE_NAME", TABLE_NAME)
    monkeypatch.setenv("BUCKET_NAME", BUCKET_NAME)
    monkeypatch.setenv("SERVICE_NAME", "recruitment")


@pytest.fixture(autouse=True)
def reset_clients(monkeypatch):
    """Los módulos cachean clientes entre invocaciones; en pruebas se limpian."""
    from common import db_dynamo, events, storage

    monkeypatch.setattr(events, "_sns", None)
    monkeypatch.setattr(db_dynamo, "_resource", None)
    monkeypatch.setattr(storage, "_s3", None)


@pytest.fixture(autouse=True)
def aws(test_env, monkeypatch):
    """Tabla PK/SK, bucket S3 y topic SNS con una cola SQS suscrita (como en AWS)."""
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
        boto3.client("s3").create_bucket(Bucket=BUCKET_NAME)

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

    def build(tenant_id="acme", role="ADMIN_RRHH", user_id="admin@acme.com",
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
def published(aws):
    def read():
        resp = aws["sqs"].receive_message(QueueUrl=aws["queue_url"], MaxNumberOfMessages=10)
        return resp.get("Messages", [])
    return read


@pytest.fixture
def make_job(api_event):
    from src.handlers import jobs

    def create(tenant_id="acme", **fields):
        payload = {"title": "Backend Developer", "description": "Python y AWS",
                   "location": "Lima", "openings": 2, **fields}
        resp = jobs.create_job(api_event(tenant_id=tenant_id, user_id=f"admin@{tenant_id}.com",
                                         body=payload), None)
        assert resp["statusCode"] == 201, resp["body"]
        return json.loads(resp["body"])

    return create


@pytest.fixture
def make_application(api_event):
    from src.handlers import applications

    def create(job_id, tenant_id="acme", **fields):
        payload = {"firstName": "Lucía", "lastName": "Pérez", "email": "lucia@mail.com",
                   "phone": "+51 999 888 777", **fields}
        resp = applications.create_application(
            api_event(tenant_id=tenant_id, user_id=f"admin@{tenant_id}.com",
                      body=payload, path={"jobId": job_id}), None,
        )
        assert resp["statusCode"] == 201, resp["body"]
        return json.loads(resp["body"])

    return create
