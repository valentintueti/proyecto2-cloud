import json

from common.db_dynamo import TenantTable
from common.events import build_event
from src import repository as repo
from src.handlers import on_employee_created


def _record(event_type="EmployeeCreated", hire_date="2025-03-01", message_id="m-1"):
    data = {"employeeId": "e-1", "email": "nuevo@acme.com", "fullName": "Nuevo", "hireDate": hire_date}
    return {"messageId": message_id, "body": json.dumps(build_event(event_type, "acme", data))}


def test_crea_saldo_del_anio_de_ingreso():
    result = on_employee_created.handler({"Records": [_record()]}, None)
    assert result == {"batchItemFailures": []}
    balance = TenantTable("acme").get(repo.balance_sk("nuevo@acme.com", 2025))
    assert balance["vacationDays"] == 30 and balance["usedDays"] == 0


def test_es_idempotente_y_no_pisa_el_saldo():
    on_employee_created.handler({"Records": [_record()]}, None)
    TenantTable("acme").update(repo.balance_sk("nuevo@acme.com", 2025), {"usedDays": 4})

    result = on_employee_created.handler({"Records": [_record(message_id="m-2")]}, None)
    assert result == {"batchItemFailures": []}
    assert TenantTable("acme").get(repo.balance_sk("nuevo@acme.com", 2025))["usedDays"] == 4


def test_ignora_otros_eventos():
    result = on_employee_created.handler({"Records": [_record(event_type="EmployeeTerminated")]}, None)
    assert result == {"batchItemFailures": []}
    assert TenantTable("acme").get(repo.balance_sk("nuevo@acme.com", 2025)) is None
