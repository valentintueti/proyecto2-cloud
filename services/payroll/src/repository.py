"""Persistence for payroll data and runs within a tenant schema."""

from common.db_pg import query

def upsert_employee(conn, employee_id, email, full_name, salary, hire_date, occurred_at):
    conn.run(
        """
        INSERT INTO payroll_employees
            (employee_id, email, full_name, base_salary, hire_date, updated_at)
        VALUES (:employee_id, :email, :full_name, :salary, :hire_date, :occurred_at)
        ON CONFLICT (employee_id) DO UPDATE SET
            email = EXCLUDED.email,
            full_name = EXCLUDED.full_name,
            base_salary = EXCLUDED.base_salary,
            hire_date = EXCLUDED.hire_date,
            updated_at = EXCLUDED.updated_at
        WHERE payroll_employees.updated_at < EXCLUDED.updated_at
        """,
        employee_id=employee_id, email=email, full_name=full_name, salary=salary,
        hire_date=hire_date, occurred_at=occurred_at,
    )


def update_employee(conn, employee_id, email, full_name, salary, occurred_at):
    updated = conn.run(
        """
        UPDATE payroll_employees
        SET email = :email, full_name = :full_name, base_salary = :salary,
            updated_at = :occurred_at
        WHERE employee_id = :employee_id AND updated_at < :occurred_at
        RETURNING employee_id
        """,
        employee_id=employee_id, email=email, full_name=full_name, salary=salary,
        occurred_at=occurred_at,
    )
    if not updated and not conn.run(
        "SELECT employee_id FROM payroll_employees WHERE employee_id = :employee_id",
        employee_id=employee_id,
    ):
        raise LookupError("EmployeeCreated todavía no está registrado en Payroll")


def terminate_employee(conn, employee_id, termination_date):
    # Keep the profile version so a delayed salary update can still be applied.
    updated = conn.run(
        """
        UPDATE payroll_employees
        SET status = 'TERMINATED', termination_date = :termination_date
        WHERE employee_id = :employee_id
        RETURNING employee_id
        """,
        employee_id=employee_id, termination_date=termination_date,
    )
    if not updated:
        raise LookupError("EmployeeCreated todavía no está registrado en Payroll")


def record_leave(conn, request_id, email, leave_type, start_date, end_date, days):
    conn.run(
        """
        INSERT INTO leave_records (request_id, email, type, start_date, end_date, days)
        VALUES (:request_id, :email, :leave_type, :start_date, :end_date, :days)
        ON CONFLICT (request_id) DO NOTHING
        """,
        request_id=request_id, email=email, leave_type=leave_type,
        start_date=start_date, end_date=end_date, days=days,
    )


def request_run(conn, period, created_by):
    rows = query(conn, """
        INSERT INTO payroll_runs (period, created_by)
        VALUES (:period, :created_by)
        ON CONFLICT (period) DO UPDATE SET status = 'PENDING', completed_at = NULL
        WHERE payroll_runs.status = 'FAILED'
        RETURNING id, status, next_offset
        """, period=period, created_by=created_by)
    if rows:
        return rows[0], True
    existing = query(conn, "SELECT id, status, next_offset FROM payroll_runs WHERE period = :period", period=period)
    return existing[0], False


def lock_run(conn, run_id):
    rows = query(conn, """
        SELECT period, status, processed, next_offset FROM payroll_runs WHERE id = :run_id FOR UPDATE
        """, run_id=run_id)
    return rows[0] if rows else None


def start_run(conn, run_id):
    conn.run("UPDATE payroll_runs SET status = 'PROCESSING' WHERE id = :run_id", run_id=run_id)


def fail_run(conn, run_id, *, status):
    conn.run("""
        UPDATE payroll_runs SET status = 'FAILED'
        WHERE id = :run_id AND status = :status
        """, run_id=run_id, status=status)


def fail_batch(conn, run_id, offset):
    conn.run("""
        UPDATE payroll_runs SET status = 'FAILED'
        WHERE id = :run_id AND next_offset = :offset AND status IN ('PENDING', 'PROCESSING')
        """, run_id=run_id, offset=offset)


def save_progress(conn, run_id, offset):
    conn.run("""
        UPDATE payroll_runs SET processed = CAST(:offset AS INTEGER) + (
            SELECT CAST(count(*) AS INTEGER) FROM payslips WHERE run_id = :run_id AND batch_offset = :offset
        ) WHERE id = :run_id
        """, run_id=run_id, offset=offset)


def advance_batch(conn, run_id):
    conn.run("UPDATE payroll_runs SET next_offset = processed WHERE id = :run_id", run_id=run_id)


def batch_payslip_count(conn, run_id, offset):
    return conn.run("""
        SELECT count(*) FROM payslips WHERE run_id = :run_id AND batch_offset = :offset
        """, run_id=run_id, offset=offset)[0][0]


def employees_without_payslip(conn, run_id, month_start, month_end, limit):
    return query(conn, """
        SELECT e.employee_id, e.email, e.full_name, e.base_salary, e.hire_date, e.termination_date
        FROM payroll_employees e
        WHERE e.hire_date <= :month_end
          AND (e.termination_date IS NULL OR e.termination_date >= :month_start)
          AND NOT EXISTS (
              SELECT 1 FROM payslips p WHERE p.run_id = :run_id AND p.employee_id = e.employee_id
          )
        ORDER BY e.employee_id
        LIMIT :limit
        """, run_id=run_id, month_start=month_start, month_end=month_end, limit=limit)


def personal_leaves_for_month(conn, emails, month_start, month_end):
    return query(conn, """
        SELECT email, start_date, end_date FROM leave_records
        WHERE email = ANY (CAST(:emails AS VARCHAR[])) AND type = 'PERSONAL'
          AND start_date <= :month_end AND end_date >= :month_start
        """, emails=emails, month_start=month_start, month_end=month_end)


def insert_payslip(conn, *, payslip_id, run_id, batch_offset, employee, period, amounts, document_key):
    conn.run("""
        INSERT INTO payslips (
            id, run_id, employee_id, email, period, base_salary, unpaid_leave_days,
            gross, pension_deduction, leave_deduction, net, document_key, batch_offset
        ) VALUES (
            :id, :run_id, :employee_id, :email, :period, :base_salary, :unpaid_leave_days,
            :gross, :pension_deduction, :leave_deduction, :net, :document_key, :batch_offset
        ) ON CONFLICT (run_id, employee_id) DO NOTHING
        """, id=payslip_id, run_id=run_id, employee_id=employee["employee_id"],
        email=employee["email"], period=period, base_salary=employee["base_salary"],
        unpaid_leave_days=amounts.unpaid_leave_days, gross=amounts.gross,
        pension_deduction=amounts.pension_deduction, leave_deduction=amounts.leave_deduction,
        net=amounts.net, document_key=document_key, batch_offset=batch_offset)


def payslips_for_notifications(conn, run_id, offset):
    return query(conn, """
        SELECT id, email, period, net FROM payslips
        WHERE run_id = :run_id AND batch_offset = :offset ORDER BY employee_id
        """, run_id=run_id, offset=offset)


def complete_run(conn, run_id):
    conn.run("""
        UPDATE payroll_runs SET
            status = 'COMPLETED', processed = totals.processed, next_offset = totals.processed, total_gross = totals.gross,
            total_net = totals.net, completed_at = now()
        FROM (
            SELECT count(*) AS processed, COALESCE(sum(gross), 0) AS gross,
                   COALESCE(sum(net), 0) AS net
            FROM payslips WHERE run_id = :run_id
        ) totals
        WHERE payroll_runs.id = :run_id
        """, run_id=run_id)
