"""Pruebas contra PostgreSQL real. Se saltan si no defines PG_TEST_HOST.

Ejemplo (PowerShell):
  $env:PG_TEST_HOST="localhost"; $env:PG_TEST_USER="postgres"
  $env:PG_TEST_PASSWORD="postgres"; $env:PG_TEST_DB="postgres"
"""
import os
import uuid
from datetime import date
from decimal import Decimal

import pytest

from common.http import ConflictError
from common.tenant import schema_name
from src import repository as repo
from src import schemas as s
from src.handlers.on_tenant_created import migration_sql

pytestmark = pytest.mark.skipif(
    not os.environ.get("PG_TEST_HOST"), reason="Define PG_TEST_HOST para usar PostgreSQL real")

A, B = "it_acme", "it_globex"


@pytest.fixture
def pg(monkeypatch):
    from common import db_pg

    monkeypatch.setenv("DB_HOST", os.environ["PG_TEST_HOST"])
    monkeypatch.setenv("DB_PORT", os.environ.get("PG_TEST_PORT", "5432"))
    monkeypatch.setenv("DB_USER", os.environ.get("PG_TEST_USER", "postgres"))
    monkeypatch.setenv("DB_PASSWORD", os.environ.get("PG_TEST_PASSWORD", ""))
    monkeypatch.setenv("DB_NAME", os.environ.get("PG_TEST_DB", "postgres"))
    monkeypatch.setattr(db_pg, "_connections", {})

    for tenant in (A, B, A):  # A dos veces: la migración es idempotente
        db_pg.create_tenant_schema(tenant, migration_sql())
    yield db_pg
    for tenant in (A, B):
        with db_pg.with_tenant(tenant) as conn:
            conn.run(f'DROP SCHEMA IF EXISTS "{schema_name(tenant)}" CASCADE')
    for conn in db_pg._connections.values():
        conn.close()


def _employee(**overrides):
    return s.new_employee({"firstName": "Ana", "lastName": "Pérez", "email": "ana@acme.com",
                           "documentNumber": "12345678", "hireDate": "2025-01-15",
                           "salary": "3500.50", **overrides})


def test_crud_and_tenant_isolation(pg):
    with pg.with_tenant(A) as conn:
        dep = repo.insert_department(conn, {"name": "TI"})
        pos = repo.insert_position(conn, s.new_position({"title": "Dev", "departmentId": str(dep["id"])}))
        boss = repo.insert_employee(conn, _employee(email="jefe@acme.com", documentNumber="1"))
        emp = repo.insert_employee(conn, _employee(
            departmentId=str(dep["id"]), positionId=str(pos["id"]), managerId=str(boss["id"])))
        assert emp["department_name"] == "TI" and emp["position_title"] == "Dev"

        items, total = repo.list_employees(conn, limit=10, offset=0, manager_id=str(boss["id"]))
        assert total == 1 and items[0]["email"] == "ana@acme.com"
        assert repo.list_employees(conn, limit=10, offset=0, q="pér")[1] == 1
        assert repo.get_employee_by_email(conn, "jefe@acme.com")["id"] == boss["id"]

        updated = repo.update_employee(conn, str(emp["id"]), {"salary": Decimal("4000.00")})
        assert updated["salary"] == Decimal("4000.00")
        done = repo.terminate_employee(conn, str(emp["id"]), date(2026, 1, 31))
        assert done["status"] == "TERMINATED"
        assert repo.terminate_employee(conn, str(emp["id"]), date(2026, 2, 1)) is None
        assert repo.find_position_by_title(conn, "DEV")["id"] == pos["id"]
        emp_id = str(emp["id"])

    with pg.with_tenant(B) as conn:
        assert repo.get_employee(conn, emp_id) is None
        assert repo.list_employees(conn, limit=10, offset=0) == ([], 0)
        assert repo.list_departments(conn) == []


def test_integrity_errors(pg):
    with pg.with_tenant(A) as conn:
        repo.insert_employee(conn, _employee())
    with pytest.raises(ConflictError, match="email"):
        with pg.with_tenant(A) as conn:
            repo.insert_employee(conn, _employee(documentNumber="999"))
    with pytest.raises(ValueError, match="Referencia"):
        with pg.with_tenant(A) as conn:
            repo.insert_employee(conn, _employee(email="b@acme.com", documentNumber="2",
                                                 departmentId=str(uuid.uuid4())))


def test_like_wildcards_are_literal(pg):
    with pg.with_tenant(A) as conn:
        repo.insert_employee(conn, _employee())
        assert repo.list_employees(conn, limit=10, offset=0, q="%")[1] == 0