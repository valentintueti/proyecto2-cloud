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


def _save_payslips(conn, tenant_id, run_id, period):
    month_start = parse_period(period)
    month_end = month_start.replace(day=monthrange(month_start.year, month_start.month)[1])
    employees = repo.employees_without_payslip(conn, run_id, month_start, month_end, BATCH_SIZE + 1)
    if len(employees) > BATCH_SIZE:
        raise ValueError("Esta versión de Payroll admite hasta 500 empleados por corrida")
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
        repo.insert_payslip(conn, payslip_id=payslip_id, run_id=run_id, employee=employee,
                            period=period, amounts=amounts, document_key=key)


def _process_run(tenant_id, run_id, period):
    with db_pg.with_tenant(tenant_id) as conn:
        run = repo.lock_run(conn, run_id)
        if run is None or run["period"] != period or run["status"] not in ("PENDING", "PROCESSING"):
            return
        repo.start_run(conn, run_id)

    try:
        with db_pg.with_tenant(tenant_id) as conn:
            if repo.lock_run(conn, run_id)["status"] != "PROCESSING":
                return
            _save_payslips(conn, tenant_id, run_id, period)

        # The payslip rows already exist when their events are sent. On a retry,
        # saved rows and their deterministic document keys are reused.
        with db_pg.with_tenant(tenant_id) as conn:
            if repo.lock_run(conn, run_id)["status"] != "PROCESSING":
                return
            payslips = repo.payslips_for_notifications(conn, run_id)
            events.publish_batch("PayslipGenerated", tenant_id, [
                {"runId": str(run_id), "payslipId": str(payslip["id"]), "email": payslip["email"],
                 "period": payslip["period"], "net": payslip["net"]}
                for payslip in payslips
            ])
            repo.complete_run(conn, run_id)
    except Exception:
        with db_pg.with_tenant(tenant_id) as conn:
            repo.fail_run(conn, run_id, status="PROCESSING")
        raise


@sqs_batch
def handler(message, context):
    if message["eventType"] != "PayrollRunRequested":
        return
    data = message["data"]
    if data["offset"] != 0:
        raise ValueError("Esta versión procesa una corrida de un solo lote")
    _process_run(message["tenantId"], UUID(data["runId"]), data["period"])
