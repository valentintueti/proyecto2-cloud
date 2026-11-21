import json
import os
from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest

from common import db_pg
from common.tenant import schema_name
from src.handlers import on_employee_event, on_leave_approved, on_tenant_created


def message(event_type, tenant, data=None, *, day=1):
    event = {
        "eventType": event_type, "tenantId": tenant,
        "occurredAt": f"2026-03-{day:02}T12:00:00+00:00", "data": data or {},
    }
    return {"Records": [{"messageId": "msg-1", "body": json.dumps(event)}]}


def test_tenant_created_uses_payroll_migration(monkeypatch):
    calls = []
    monkeypatch.setattr(db_pg, "create_tenant_schema", lambda *args: calls.append(args))
    assert on_tenant_created.handler(message("TenantCreated", "acme"), None) == {"batchItemFailures": []}
    [(tenant, sql)] = calls
    assert tenant == "acme"
    for table in ("payroll_employees", "leave_records", "payroll_runs", "payslips"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql


@pytest.fixture
def payroll_tenants():
    if os.environ.get("PAYROLL_TEST_PG") != "1":
        pytest.skip("Configura PAYROLL_TEST_PG=1 y DB_* para usar PostgreSQL de pruebas")

    prefix = f"paytest_{uuid4().hex[:8]}"
    tenants = [f"{prefix}_a", f"{prefix}_b"]
    created_tenants = []
    try:
        for tenant in tenants:
            assert on_tenant_created.handler(message("TenantCreated", tenant), None) == {"batchItemFailures": []}
            created_tenants.append(tenant)
        yield tenants
    finally:
        for tenant in created_tenants:
            with db_pg.with_tenant(tenant) as conn:
                conn.run(f'DROP SCHEMA "{schema_name(tenant)}" CASCADE')


def test_employee_events_preserve_latest_profile_and_termination(payroll_tenants):
    tenant, other = payroll_tenants
    employee = {"employeeId": str(uuid4()), "email": "ana@example.com", "fullName": "Ana Pérez", "salary": "3000.10"}
    creation = message("EmployeeCreated", tenant, {**employee, "hireDate": "2026-03-01"})
    change = message("EmployeeUpdated", tenant, {**employee, "salary": "4120.55", "fullName": "Ana Ruiz"}, day=3)
    termination = message("EmployeeTerminated", tenant, {"employeeId": employee["employeeId"], "terminationDate": "2026-03-15"}, day=4)

    assert on_employee_event.handler(change, None) == {"batchItemFailures": [{"itemIdentifier": "msg-1"}]}
    for event in (creation, termination, change, change, creation):
        assert on_employee_event.handler(event, None) == {"batchItemFailures": []}

    with db_pg.with_tenant(tenant) as conn:
        assert conn.run("SELECT full_name, base_salary, hire_date, status, termination_date FROM payroll_employees") == [
            ["Ana Ruiz", Decimal("4120.55"), date(2026, 3, 1), "TERMINATED", date(2026, 3, 15)],
        ]
    with db_pg.with_tenant(other) as conn:
        assert not conn.run("SELECT employee_id FROM payroll_employees")


def test_leave_approval_is_idempotent_and_tenant_scoped(payroll_tenants):
    tenant, other = payroll_tenants
    leave = {
        "requestId": str(uuid4()), "email": "ANA@example.com", "type": "PERSONAL",
        "startDate": "2026-03-05", "endDate": "2026-03-06", "days": 2,
    }
    for event in (message("LeaveApproved", tenant, leave), message("LeaveApproved", tenant, {**leave, "days": 1})):
        assert on_leave_approved.handler(event, None) == {"batchItemFailures": []}

    with db_pg.with_tenant(tenant) as conn:
        assert conn.run("SELECT email, type, days FROM leave_records") == [["ana@example.com", "PERSONAL", 2]]
    with db_pg.with_tenant(other) as conn:
        assert not conn.run("SELECT request_id FROM leave_records")
