from common import db_pg, events
from common.http import ConflictError, handle_errors, not_found, ok, parse_body, path_param, response
from common.tenant import require_role
from src import repository as repo
from src.schemas import pagination, parse_id, to_api, validate_requested_period


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
            events.publish("PayrollRunRequested", tenant_id, {
                "runId": run_id, "period": period, "offset": run["next_offset"],
            })
        except Exception:
            with db_pg.with_tenant(tenant_id) as conn:
                repo.fail_run(conn, run["id"], status="PENDING")
            raise
    return response(202, {"runId": run_id, "period": period, "status": "PENDING"})


@handle_errors
def list_runs(event, context):
    auth = require_role(event, "ADMIN_RRHH")
    limit, offset = pagination(event)
    with db_pg.with_tenant(auth["tenantId"]) as conn:
        runs, total = repo.list_runs(conn, limit, offset)
    return ok({"items": [to_api(run, "runId") for run in runs], "total": total,
               "limit": limit, "offset": offset})


@handle_errors
def get_run(event, context):
    auth = require_role(event, "ADMIN_RRHH")
    run_id = parse_id(path_param(event, "runId"), "runId")
    with db_pg.with_tenant(auth["tenantId"]) as conn:
        run = repo.get_run(conn, run_id)
    if run is None:
        return not_found("Corrida de planilla no encontrada")
    return ok(to_api(run, "runId"))
