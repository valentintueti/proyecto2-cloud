import json
from decimal import Decimal
from uuid import uuid4

import boto3
import pytest
from moto import mock_aws

from common import db_pg, events, storage
from src.handlers import on_employee_event, on_leave_approved, on_payroll_run_requested, payroll_runs


PERIOD = "2026-03"


def api_event(tenant, period=PERIOD, role="ADMIN_RRHH"):
    return {
        "body": json.dumps({"period": period}),
        "requestContext": {"authorizer": {"tenantId": tenant, "userId": "admin@example.com", "role": role}},
    }


def sqs_event(event_type, tenant, data):
    envelope = events.build_event(event_type, tenant, data)
    return {"Records": [{"messageId": "fixture", "body": json.dumps(envelope)}]}


def create_employee(tenant, name, email, hire_date):
    event = sqs_event("EmployeeCreated", tenant, {
        "employeeId": str(uuid4()), "fullName": name, "email": email,
        "salary": "3000.00", "hireDate": hire_date,
    })
    assert on_employee_event.handler(event, None) == {"batchItemFailures": []}


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setattr(events, "_sns", None)
    monkeypatch.setattr(storage, "_s3", None)
    with mock_aws():
        s3, sns, sqs = (boto3.client(service) for service in ("s3", "sns", "sqs"))
        bucket = "payroll-test-payslips"
        s3.create_bucket(Bucket=bucket)
        topic = sns.create_topic(Name="hcm-events")["TopicArn"]
        queues = {}
        for event_type in ("PayrollRunRequested", "PayslipGenerated"):
            queue = sqs.create_queue(QueueName=event_type)["QueueUrl"]
            arn = sqs.get_queue_attributes(QueueUrl=queue, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
            sns.subscribe(TopicArn=topic, Protocol="sqs", Endpoint=arn, Attributes={
                "RawMessageDelivery": "true", "FilterPolicy": json.dumps({"eventType": [event_type]}),
            })
            queues[event_type] = queue
        monkeypatch.setenv("EVENTS_TOPIC_ARN", topic)
        monkeypatch.setenv("BUCKET_NAME", bucket)

        def receive(event_type):
            url = queues[event_type]
            messages = sqs.receive_message(QueueUrl=url, MaxNumberOfMessages=10).get("Messages", [])
            for message in messages:
                sqs.delete_message(QueueUrl=url, ReceiptHandle=message["ReceiptHandle"])
            return [{"messageId": message["MessageId"], "body": message["Body"]} for message in messages]

        yield receive, s3, bucket


def test_small_run_creates_pdfs_events_and_totals(payroll_tenants, aws):
    tenant, other = payroll_tenants
    receive, s3, bucket = aws
    create_employee(tenant, "Ana Pérez", "ana@example.com", "2025-01-01")
    create_employee(tenant, "Luis Ruiz", "luis@example.com", "2026-03-31")
    create_employee(tenant, "Alta posterior", "posterior@example.com", "2026-04-01")
    create_employee(other, "Otra empresa", "ana@example.com", "2025-01-01")
    leave = sqs_event("LeaveApproved", tenant, {
        "requestId": str(uuid4()), "email": "ana@example.com", "type": "PERSONAL",
        "startDate": "2026-03-05", "endDate": "2026-03-06", "days": 2,
    })
    assert on_leave_approved.handler(leave, None) == {"batchItemFailures": []}

    response = payroll_runs.create_run(api_event(tenant), None)
    assert response["statusCode"] == 202
    request = json.loads(response["body"])
    assert json.loads(payroll_runs.create_run(api_event(tenant), None)["body"]) == request
    records = receive("PayrollRunRequested")
    assert len(records) == 1
    assert json.loads(records[0]["body"])["data"] == {"runId": request["runId"], "period": PERIOD, "offset": 0}
    for _ in range(2):
        assert on_payroll_run_requested.handler({"Records": records}, None) == {"batchItemFailures": []}
    assert payroll_runs.create_run(api_event(tenant), None)["statusCode"] == 409

    with db_pg.with_tenant(tenant) as conn:
        assert conn.run("SELECT status, processed, total_gross, total_net FROM payroll_runs") == [
            ["COMPLETED", 2, Decimal("3100.00"), Decimal("2497.00")],
        ]
        slips = db_pg.query(conn, "SELECT id, email, net, document_key FROM payslips ORDER BY email")
    with db_pg.with_tenant(other) as conn:
        assert not conn.run("SELECT id FROM payroll_runs")
        assert not conn.run("SELECT id FROM payslips")

    assert [(slip["email"], slip["net"]) for slip in slips] == [
        ("ana@example.com", Decimal("2410.00")), ("luis@example.com", Decimal("87.00")),
    ]
    published = [json.loads(record["body"]) for record in receive("PayslipGenerated")]
    assert {event["tenantId"] for event in published} == {tenant}
    assert sorted(event["data"]["payslipId"] for event in published) == sorted(str(slip["id"]) for slip in slips)
    assert s3.list_objects_v2(Bucket=bucket)["KeyCount"] == 2
    for slip in slips:
        stored = s3.get_object(Bucket=bucket, Key=slip["document_key"])
        assert stored["ContentType"] == "application/pdf"
        assert stored["Body"].read().startswith(b"%PDF-1.4")


def test_failed_run_reuses_saved_payslip(payroll_tenants, aws, monkeypatch):
    tenant, _ = payroll_tenants
    receive, _, _ = aws
    create_employee(tenant, "Ana Pérez", "ana@example.com", "2025-01-01")
    started = json.loads(payroll_runs.create_run(api_event(tenant), None)["body"])
    record = receive("PayrollRunRequested")

    def fail_publish(*args, **kwargs):
        raise RuntimeError("SNS no disponible")

    with monkeypatch.context() as patch:
        patch.setattr(events, "publish_batch", fail_publish)
        failures = on_payroll_run_requested.handler({"Records": record}, None)
        assert failures == {"batchItemFailures": [{"itemIdentifier": record[0]["messageId"]}]}

    with db_pg.with_tenant(tenant) as conn:
        assert conn.run("SELECT status FROM payroll_runs") == [["FAILED"]]
        [saved] = conn.run("SELECT id FROM payslips")

    retry = payroll_runs.create_run(api_event(tenant), None)
    assert retry["statusCode"] == 202 and json.loads(retry["body"]) == started
    assert on_payroll_run_requested.handler({"Records": receive("PayrollRunRequested")}, None) == {"batchItemFailures": []}
    with db_pg.with_tenant(tenant) as conn:
        assert conn.run("SELECT id FROM payslips") == [saved]
        assert conn.run("SELECT status, processed, total_net FROM payroll_runs") == [["COMPLETED", 1, Decimal("2610.00")]]


@pytest.mark.parametrize(("period", "role", "expected"), [
    ("2026-3", "ADMIN_RRHH", 400), ("9999-01", "ADMIN_RRHH", 400),
    ("0000-01", "ADMIN_RRHH", 400), (PERIOD, "EMPLOYEE", 403),
])
def test_create_run_rejects_invalid_requests_before_accessing_db(period, role, expected):
    assert payroll_runs.create_run(api_event("acme", period, role), None)["statusCode"] == expected
