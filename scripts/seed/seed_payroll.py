"""payroll: fichas salariales, ausencias aprobadas y una corrida COMPLETED del mes anterior.

Las boletas se calculan con el mismo calculator.py del servicio. Solo los usuarios de demo
(empleado1..20) tienen el PDF en S3; el resto tiene la fila pero no el archivo.
"""
import sys
from calendar import monthrange
from datetime import timedelta

from context import ROOT, bootstrap, to_json  # primero: agrega shared/python al path
from common import db_pg, storage
from people import DEMO_USERS, TODAY, admin_email, stable_id

sys.path.insert(0, str(ROOT / "services" / "payroll"))
from src.calculator import ApprovedLeave, calculate_payslip  # noqa: E402
from src.payslip_document import render_payslip  # noqa: E402

BATCH = 1000


def previous_month():
    end = TODAY.replace(day=1) - timedelta(days=1)
    return end.replace(day=1), end.replace(day=monthrange(end.year, end.month)[1])


def employee_rows(company):
    return [{
        "employee_id": p.id, "email": p.email, "full_name": p.full_name[:161],
        "base_salary": p.salary, "hire_date": p.hire_date, "termination_date": p.termination_date,
        "status": p.status,
    } for p in company.people]


def leave_rows(company):
    return [{
        "request_id": leave.id, "email": leave.person.email, "type": leave.type,
        "start_date": leave.start, "end_date": leave.end, "days": leave.days,
    } for leave in company.leaves if leave.status == "APPROVED"]


def payslip_rows(company, run_id: str, period: str):
    month_start, month_end = previous_month()
    personal = {}
    for leave in company.leaves:
        if leave.status == "APPROVED" and leave.type == "PERSONAL":
            personal.setdefault(leave.person.email, []).append(ApprovedLeave("PERSONAL", leave.start, leave.end))
    rows = []
    for person in company.people:
        if person.hire_date > month_end or (person.termination_date and person.termination_date < month_start):
            continue
        amounts = calculate_payslip(
            base_salary=person.salary, period=month_start, hire_date=person.hire_date,
            termination_date=person.termination_date, approved_leaves=personal.get(person.email, ()),
        )
        payslip_id = stable_id(company.tenant, "payslip", period, person.n)
        rows.append({
            "id": payslip_id, "run_id": run_id, "employee_id": person.id, "email": person.email,
            "period": period, "base_salary": person.salary, "unpaid_leave_days": amounts.unpaid_leave_days,
            "gross": amounts.gross, "pension_deduction": amounts.pension_deduction,
            "leave_deduction": amounts.leave_deduction, "net": amounts.net,
            "document_key": storage.tenant_key(company.tenant, "payslips", period, f"{payslip_id}.pdf"),
            "batch_offset": 0,
            "_person": person, "_amounts": amounts,
        })
    return rows


INSERT_EMPLOYEES = """
    INSERT INTO payroll_employees (employee_id, email, full_name, base_salary, hire_date,
                                   termination_date, status, updated_at)
    SELECT employee_id, email, full_name, base_salary, hire_date, termination_date, status, now()
    FROM jsonb_to_recordset(CAST(:rows AS JSONB)) AS x(
        employee_id UUID, email TEXT, full_name TEXT, base_salary NUMERIC, hire_date DATE,
        termination_date DATE, status TEXT)
    ON CONFLICT DO NOTHING
"""
INSERT_LEAVES = """
    INSERT INTO leave_records (request_id, email, type, start_date, end_date, days)
    SELECT request_id, email, type, start_date, end_date, days
    FROM jsonb_to_recordset(CAST(:rows AS JSONB)) AS x(
        request_id UUID, email TEXT, type TEXT, start_date DATE, end_date DATE, days INTEGER)
    ON CONFLICT DO NOTHING
"""
INSERT_PAYSLIPS = """
    INSERT INTO payslips (id, run_id, employee_id, email, period, base_salary, unpaid_leave_days, gross,
                          pension_deduction, leave_deduction, net, document_key, batch_offset)
    SELECT id, run_id, employee_id, email, period, base_salary, unpaid_leave_days, gross,
           pension_deduction, leave_deduction, net, document_key, batch_offset
    FROM jsonb_to_recordset(CAST(:rows AS JSONB)) AS x(
        id UUID, run_id UUID, employee_id UUID, email TEXT, period TEXT, base_salary NUMERIC,
        unpaid_leave_days INTEGER, gross NUMERIC, pension_deduction NUMERIC, leave_deduction NUMERIC,
        net NUMERIC, document_key TEXT, batch_offset INTEGER)
    ON CONFLICT DO NOTHING
"""


def _in_batches(ctx, tenant, sql, rows):
    for start in range(0, len(rows), BATCH):
        with db_pg.with_tenant(tenant, db_name=ctx.payroll_db) as conn:
            conn.run(sql, rows=to_json(rows[start:start + BATCH]))


def seed(ctx, company) -> int:
    tenant = company.tenant
    db_pg.create_tenant_schema(tenant, bootstrap.migration_sql("payroll"), db_name=ctx.payroll_db)
    with db_pg.with_tenant(tenant, db_name=ctx.payroll_db) as conn:
        conn.run("INSERT INTO company_profile (id, name) VALUES (TRUE, :name) ON CONFLICT (id) DO NOTHING",
                 name=tenant.title())

    employees = employee_rows(company)
    leaves = leave_rows(company)
    _in_batches(ctx, tenant, INSERT_EMPLOYEES, employees)
    _in_batches(ctx, tenant, INSERT_LEAVES, leaves)

    period = previous_month()[0].strftime("%Y-%m")
    run_id = stable_id(tenant, "payroll-run", period)
    with db_pg.with_tenant(tenant, db_name=ctx.payroll_db) as conn:
        created = conn.run("""
            INSERT INTO payroll_runs (id, period, status, created_by)
            VALUES (:id, :period, 'PROCESSING', :created_by)
            ON CONFLICT DO NOTHING RETURNING id
            """, id=run_id, period=period, created_by=admin_email(tenant))
    if not created:
        print(f"    ya existe una corrida para {period}: no se generan boletas")
        return len(employees) + len(leaves)

    slips = payslip_rows(company, run_id, period)
    _in_batches(ctx, tenant, INSERT_PAYSLIPS,
                [{k: v for k, v in row.items() if not k.startswith("_")} for row in slips])
    with db_pg.with_tenant(tenant, db_name=ctx.payroll_db) as conn:
        conn.run("""
            UPDATE payroll_runs SET status = 'COMPLETED', processed = t.n, next_offset = t.n,
                   total_gross = t.gross, total_net = t.net, completed_at = now()
            FROM (SELECT count(*) AS n, COALESCE(sum(gross), 0) AS gross, COALESCE(sum(net), 0) AS net
                  FROM payslips WHERE run_id = :id) t
            WHERE payroll_runs.id = :id
            """, id=run_id)

    for row in slips:          # PDF real solo para los usuarios de demo
        if row["_person"].n <= DEMO_USERS:
            document = render_payslip(tenant.title(), row["_person"].full_name, period, row["_amounts"])
            storage.put_bytes(tenant, row["document_key"], document, "application/pdf")
    return len(employees) + len(leaves) + len(slips)
