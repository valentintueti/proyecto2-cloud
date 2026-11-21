from datetime import date
from uuid import UUID

from common import db_pg
from common.events import sqs_batch
from src import repository as repo


@sqs_batch
def handler(message, context):
    if message["eventType"] != "LeaveApproved":
        return

    data = message["data"]
    with db_pg.with_tenant(message["tenantId"]) as conn:
        repo.record_leave(
            conn,
            request_id=UUID(data["requestId"]),
            email=data["email"].strip().lower(),
            leave_type=data["type"],
            start_date=date.fromisoformat(data["startDate"]),
            end_date=date.fromisoformat(data["endDate"]),
            days=data["days"],
        )
