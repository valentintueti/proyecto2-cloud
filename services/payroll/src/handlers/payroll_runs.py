from common import db_pg, events
from common.http import ConflictError, handle_errors, parse_body, response
from common.tenant import require_role
from src import repository as repo
from src.schemas import validate_requested_period


@handle_errors
def create_run(event, context):
    auth = require_role(event, "ADMIN_RRHH")
    tenant_id = auth["tenantId"]
    period = parse_body(event).get("period")
    validate_requested_period(period)

    with db_pg.with_tenant(tenant_id) as conn:
        run, should_publish = repo.request_run(conn, period, auth["userId"])
        if not should_publish and run["status"] != "PENDING":
            raise ConflictError("Ya existe una corrida de planilla para ese período")

    run_id = str(run["id"])
    if should_publish:
        try:
            events.publish("PayrollRunRequested", tenant_id, {"runId": run_id, "period": period, "offset": 0})
        except Exception:
            with db_pg.with_tenant(tenant_id) as conn:
                repo.fail_run(conn, run["id"], status="PENDING")
            raise
    return response(202, {"runId": run_id, "period": period, "status": "PENDING"})
