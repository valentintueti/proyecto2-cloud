import logging

from common.db_dynamo import TenantTable
from common.events import sqs_batch
from common.http import ConflictError
from src import repository as repo

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _on_created(table: TenantTable, data: dict):
    sk = repo.user_sk(data["email"])
    existing = table.get(sk)
    if existing:
        if existing.get("employeeId") != data["employeeId"]:
            table.update(sk, {"employeeId": str(data["employeeId"]), "updatedAt": repo.now_iso()})
        return
    user = repo.new_user(
        data["email"], data.get("fullName") or data["email"], "EMPLOYEE",
        employee_id=data["employeeId"],
    )
    try:
        table.put(sk, user, if_not_exists=True)
    except ConflictError:
        pass  # otro reintento ya lo creó: idempotente


def _on_terminated(table: TenantTable, data: dict):
    sk = repo.user_sk(data["email"])
    if table.get(sk):
        table.update(sk, {"status": "DISABLED", "updatedAt": repo.now_iso()})


HANDLERS = {"EmployeeCreated": _on_created, "EmployeeTerminated": _on_terminated}


@sqs_batch
def handler(message, context):
    action = HANDLERS.get(message["eventType"])
    if action is None:
        logger.info("Evento ignorado: %s", message["eventType"])
        return
    action(TenantTable(message["tenantId"]), message.get("data") or {})