"""Persistence for payroll data received from other services."""

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
