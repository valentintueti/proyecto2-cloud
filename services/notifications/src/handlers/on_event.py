import logging
import os

import boto3

from common.events import sqs_batch
from src import messages
from src import repository as repo

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_ses = None


def _ses_client():
    global _ses
    if _ses is None:
        _ses = boto3.client("ses")
    return _ses


def _email_enabled() -> bool:
    return os.environ.get("EMAIL_ENABLED", "false").strip().lower() == "true"


def send_email(item: dict) -> bool:
    """Envío opcional por SES. Nunca lanza: la bandeja es la fuente de verdad."""
    if not _email_enabled():
        return False
    sender = os.environ.get("EMAIL_SENDER")
    if not sender:
        logger.warning("EMAIL_ENABLED=true pero falta EMAIL_SENDER")
        return False
    try:
        _ses_client().send_email(
            Source=sender,
            Destination={"ToAddresses": [item["email"]]},
            Message={
                "Subject": {"Data": item["title"], "Charset": "UTF-8"},
                "Body": {"Text": {"Data": item["message"], "Charset": "UTF-8"}},
            },
        )
        return True
    except Exception:
        logger.exception("No se pudo enviar el correo de la notificación %s", item["notificationId"])
        return False


@sqs_batch
def handler(message, context):
    drafts = messages.build(message["eventType"], message.get("data") or {})
    if not drafts:
        logger.info("Evento ignorado: %s", message["eventType"])
        return
    for draft in drafts:
        sk, item = repo.new_notification(draft, message.get("eventId"), message.get("occurredAt"))
        if not repo.save_once(message["tenantId"], sk, item):
            logger.info("Notificación %s ya existía (evento repetido)", item["notificationId"])
            continue
        send_email(item)
