from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from common import db_pg
from common.events import sqs_batch
from src import repository as repo


@sqs_batch
def handler(message, context):
    event_type = message["eventType"]
    if event_type not in ("EmployeeCreated", "EmployeeUpdated", "EmployeeTerminated"):
        return

    data = message["data"]
    employee_id = UUID(data["employeeId"])
    with db_pg.with_tenant(message["tenantId"]) as conn:
        if event_type == "EmployeeTerminated":
            repo.terminate_employee(conn, employee_id, date.fromisoformat(data["terminationDate"]))
            return

        profile = {
            "employee_id": employee_id,
            "email": data["email"].strip().lower(),
            "full_name": data["fullName"],
            "salary": Decimal(str(data["salary"])),
            "occurred_at": datetime.fromisoformat(message["occurredAt"]),
        }
        if event_type == "EmployeeCreated":
            repo.upsert_employee(conn, hire_date=date.fromisoformat(data["hireDate"]), **profile)
        else:
            repo.update_employee(conn, **profile)
