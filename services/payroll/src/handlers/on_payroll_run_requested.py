from calendar import monthrange
from collections import defaultdict
from uuid import UUID, uuid5

from common import db_pg, events, storage
from common.events import sqs_batch
from src import repository as repo
from src.calculator import ApprovedLeave, calculate_payslip
from src.payslip_document import render_payslip
from src.schemas import parse_period


BATCH_SIZE = 500


def _save_payslips(conn, tenant_id, run_id, period, offset, month_start, month_end):
    # Old runs can already have saved slips at offset zero when migrated.
    saved = repo.batch_payslip_count(conn, run_id, offset)
    remaining_capacity = max(0, BATCH_SIZE - saved)
    employees = repo.employees_without_payslip(conn, run_id, month_start, month_end, remaining_capacity)
    if not employees:
        return

    leaves_by_email = defaultdict(list)
    emails = [employee["email"] for employee in employees]
    for leave in repo.personal_leaves_for_month(conn, emails, month_start, month_end):
        leaves_by_email[leave["email"]].append(ApprovedLeave("PERSONAL", leave["start_date"], leave["end_date"]))

    for employee in employees:
        amounts = calculate_payslip(
            base_salary=employee["base_salary"], period=month_start, hire_date=employee["hire_date"],
            termination_date=employee["termination_date"], approved_leaves=leaves_by_email[employee["email"]],
        )
        payslip_id = uuid5(run_id, str(employee["employee_id"]))
        key = storage.tenant_key(tenant_id, "payslips", period, f"{payslip_id}.pdf")
        document = render_payslip(tenant_id, employee["full_name"], period, amounts)
        storage.put_bytes(tenant_id, key, document, "application/pdf")
        repo.insert_payslip(conn, payslip_id=payslip_id, run_id=run_id, batch_offset=offset, employee=employee,
                            period=period, amounts=amounts, document_key=key)


def _active_run(conn, run_id, period):
    run = repo.lock_run(conn, run_id)
    if run and run["period"] == period and run["status"] in ("PENDING", "PROCESSING"):
        return run
    return None


def _persist_batch(tenant_id, run_id, period, offset, month_start, month_end):
    with db_pg.with_tenant(tenant_id) as conn:
        run = _active_run(conn, run_id, period)
        if not run:
            return False
        if offset < run["next_offset"]:
            return True
        if offset > run["next_offset"]:
            raise ValueError("El lote anterior aún no ha terminado")
        if run["status"] == "PENDING":
            repo.start_run(conn, run_id)
        if run["processed"] == offset:
            _save_payslips(conn, tenant_id, run_id, period, offset, month_start, month_end)
            repo.save_progress(conn, run_id, offset)
        return True


def _finish_batch(tenant_id, run_id, period, offset, month_start, month_end):
    with db_pg.with_tenant(tenant_id) as conn:
        run = _active_run(conn, run_id, period)
        if not run or run["status"] != "PROCESSING":
            return None
        if offset < run["next_offset"]:
            # If the worker stopped after committing the checkpoint, replay
            # the continuation without publishing the previous slips again.
            return run["next_offset"]
        if offset > run["next_offset"]:
            raise ValueError("El lote anterior aún no ha terminado")

        has_more = repo.employees_without_payslip(conn, run_id, month_start, month_end, 1)
        payslips = repo.payslips_for_notifications(conn, run_id, offset)
        events.publish_batch("PayslipGenerated", tenant_id, [
            {"runId": str(run_id), "payslipId": str(payslip["id"]), "email": payslip["email"],
             "period": payslip["period"], "net": payslip["net"]}
            for payslip in payslips
        ])
        if has_more:
            repo.advance_batch(conn, run_id)
            return run["processed"]

        repo.complete_run(conn, run_id)
        return None


def _process_run(tenant_id, run_id, period, offset):
    month_start = parse_period(period)
    month_end = month_start.replace(day=monthrange(month_start.year, month_start.month)[1])
    failure_offset = offset
    try:
        if not _persist_batch(tenant_id, run_id, period, offset, month_start, month_end):
            return
        next_offset = _finish_batch(tenant_id, run_id, period, offset, month_start, month_end)
        if next_offset is not None:
            failure_offset = next_offset
            events.publish("PayrollRunRequested", tenant_id, {
                "runId": str(run_id), "period": period, "offset": next_offset,
            })
    except Exception:
        with db_pg.with_tenant(tenant_id) as conn:
            repo.fail_batch(conn, run_id, failure_offset)
        raise


@sqs_batch
def handler(message, context):
    if message["eventType"] != "PayrollRunRequested":
        return
    data = message["data"]
    offset = data["offset"]
    if type(offset) is not int or offset < 0:
        raise ValueError("offset debe ser un entero mayor o igual que cero")
    _process_run(message["tenantId"], UUID(data["runId"]), data["period"], offset)
