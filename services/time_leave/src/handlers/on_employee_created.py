import logging

from common.db_dynamo import TenantTable
from common.events import sqs_batch
from common.http import ConflictError
from src import repository as repo

logger = logging.getLogger()
logger.setLevel(logging.INFO)


@sqs_batch
def handler(message, context):
    if message["eventType"] != "EmployeeCreated":
        logger.info("Evento ignorado: %s", message["eventType"])
        return
    data = message.get("data") or {}
    email = repo.normalize_email(data.get("email"))
    year = repo.parse_date(str(data.get("hireDate") or "")[:10], "hireDate").year
    try:
        TenantTable(message["tenantId"]).put(
            repo.balance_sk(email, year), repo.default_balance(email, year), if_not_exists=True,
        )
    except ConflictError:
        logger.info("El saldo de %s para %s ya existía", email, year)  # idempotente
