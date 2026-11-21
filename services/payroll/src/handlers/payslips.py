from common import db_pg, storage
from common.auth import ROLES
from common.http import handle_errors, not_found, ok, path_param
from common.tenant import require_role
from src import repository as repo
from src.schemas import pagination, parse_id, search_term, to_api


def _page_response(slips, total, limit, offset):
    return ok({"items": [to_api(slip, "payslipId") for slip in slips], "total": total,
               "limit": limit, "offset": offset})


@handle_errors
def list_run_payslips(event, context):
    auth = require_role(event, "ADMIN_RRHH")
    run_id = parse_id(path_param(event, "runId"), "runId")
    limit, offset = pagination(event)
    term = search_term(event)
    with db_pg.with_tenant(auth["tenantId"]) as conn:
        if repo.get_run(conn, run_id) is None:
            return not_found("Corrida de planilla no encontrada")
        slips, total = repo.list_run_payslips(conn, run_id, term, limit, offset)
    return _page_response(slips, total, limit, offset)


@handle_errors
def my_payslips(event, context):
    auth = require_role(event, *ROLES)
    limit, offset = pagination(event)
    with db_pg.with_tenant(auth["tenantId"]) as conn:
        slips, total = repo.list_employee_payslips(conn, auth["userId"].lower(), limit, offset)
    return _page_response(slips, total, limit, offset)


@handle_errors
def document_url(event, context):
    auth = require_role(event, *ROLES)
    payslip_id = parse_id(path_param(event, "payslipId"), "payslipId")
    tenant_id = auth["tenantId"]
    with db_pg.with_tenant(tenant_id) as conn:
        slip = repo.get_payslip_document(conn, payslip_id)
    if slip is None:
        return not_found("Boleta no encontrada")
    if auth["role"] != "ADMIN_RRHH" and slip["email"] != auth["userId"].lower():
        raise PermissionError("No tienes permiso para descargar esta boleta")

    url = storage.presigned_download(tenant_id, slip["document_key"], expires_in=300)
    return ok({"downloadUrl": url})
