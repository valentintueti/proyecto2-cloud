import json

import boto3
import pytest
from moto import mock_aws

from common import events
from common.tenant import TenantError


@pytest.fixture
def queue(monkeypatch):
    """Topic SNS con una cola SQS suscrita (RawMessageDelivery), como en AWS."""
    with mock_aws():
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
        monkeypatch.setenv("SERVICE_NAME", "employees")
        yield sqs, queue_url


def test_publish_llega_a_la_cola_y_se_parsea(queue):
    sqs, queue_url = queue
    sent = events.publish("EmployeeCreated", "acme", {"employeeId": 7})

    messages = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)["Messages"]
    received = events.parse_record({"messageId": "m-1", "body": messages[0]["Body"]})

    assert received["eventId"] == sent["eventId"]
    assert received["eventType"] == "EmployeeCreated"
    assert received["tenantId"] == "acme"
    assert received["source"] == "employees"
    assert received["data"] == {"employeeId": 7}


def test_parse_record_sin_raw_delivery():
    envelope = events.build_event("TenantCreated", "globex", {"name": "Globex"})
    body = json.dumps({"Type": "Notification", "Message": json.dumps(envelope)})
    assert events.parse_record({"body": body})["tenantId"] == "globex"


def test_parse_record_rechaza_mensajes_invalidos():
    with pytest.raises(ValueError):
        events.parse_record({"body": json.dumps({"tenantId": "acme"})})
    with pytest.raises(TenantError):
        events.parse_record({"body": json.dumps({"eventType": "X", "tenantId": "ACME; DROP"})})


def test_publish_valida_antes_de_enviar(monkeypatch):
    with pytest.raises(TenantError):
        events.publish("EmployeeCreated", "no valido", {})
    monkeypatch.delenv("EVENTS_TOPIC_ARN", raising=False)
    with pytest.raises(RuntimeError):
        events.publish("EmployeeCreated", "acme", {})


def test_sqs_batch_reporta_solo_los_fallidos():
    procesados = []

    @events.sqs_batch
    def handler(event, context):
        if event["data"].get("fail"):
            raise RuntimeError("falló")
        procesados.append(event["data"]["n"])

    def record(message_id, data):
        return {"messageId": message_id, "body": json.dumps(events.build_event("X", "acme", data))}

    result = handler(
        {"Records": [record("ok-1", {"n": 1}), record("bad", {"fail": True}), record("ok-2", {"n": 2})]},
        None,
    )
    assert procesados == [1, 2]
    assert result == {"batchItemFailures": [{"itemIdentifier": "bad"}]}