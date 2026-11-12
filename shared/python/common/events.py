import functools
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import boto3

from .http import _json_default
from .tenant import TenantError, is_valid_tenant_id

logger = logging.getLogger(__name__)

_sns = None


def _sns_client():
    global _sns
    if _sns is None:
        _sns = boto3.client("sns")
    return _sns


def build_event(event_type: str, tenant_id: str, data: dict | None = None) -> dict:
    """Sobre común para todos los eventos del sistema."""
    if not event_type:
        raise ValueError("Falta eventType")
    if not is_valid_tenant_id(tenant_id):
        raise TenantError(f"tenantId inválido: {tenant_id!r}")
    return {
        "eventId": str(uuid.uuid4()),
        "eventType": event_type,
        "tenantId": tenant_id,
        "source": os.environ.get("SERVICE_NAME", "unknown"),
        "occurredAt": datetime.now(timezone.utc).isoformat(),
        "data": data or {},
    }


def publish(event_type: str, tenant_id: str, data: dict | None = None, topic_arn: str | None = None) -> dict:
    """Publica en el topic hcm-events. eventType y tenantId van también como
    MessageAttributes para que las suscripciones SQS puedan filtrar."""
    event = build_event(event_type, tenant_id, data)
    arn = topic_arn or os.environ.get("EVENTS_TOPIC_ARN")
    if not arn:
        raise RuntimeError("Falta la variable de entorno EVENTS_TOPIC_ARN")
    _sns_client().publish(
        TopicArn=arn,
        Message=json.dumps(event, default=_json_default, ensure_ascii=False),
        MessageAttributes={
            "eventType": {"DataType": "String", "StringValue": event_type},
            "tenantId": {"DataType": "String", "StringValue": tenant_id},
        },
    )
    return event


def parse_record(record: dict) -> dict:
    """Extrae el evento de un mensaje SQS (con o sin RawMessageDelivery)."""
    body = json.loads(record["body"])
    if body.get("Type") == "Notification" and "Message" in body:
        body = json.loads(body["Message"])
    if not body.get("eventType"):
        raise ValueError("Mensaje sin eventType")
    if not is_valid_tenant_id(body.get("tenantId")):
        raise TenantError("Mensaje sin tenantId válido")
    return body


def sqs_batch(func):
    """Decorador para consumidores SQS: llama a func(evento, context) por cada
    mensaje y reporta solo los que fallaron, para que SQS reintente esos.
    Requiere `functionResponseType: ReportBatchItemFailures` en serverless.yml."""

    @functools.wraps(func)
    def wrapper(event, context):
        failures = []
        for record in event.get("Records", []):
            try:
                func(parse_record(record), context)
            except Exception:
                logger.exception("Falló el mensaje %s", record.get("messageId"))
                failures.append({"itemIdentifier": record["messageId"]})
        return {"batchItemFailures": failures}

    return wrapper