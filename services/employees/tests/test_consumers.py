import json
from datetime import date
from decimal import Decimal

from conftest import ADMIN
from src.handlers import departments, on_candidate_hired, on_tenant_created, positions

APP_ID = "3f6c0e0a-1111-4222-8333-444455556666"


def _sqs(*messages):
    return {"Records": [{"messageId": f"m{i}", "body": json.dumps(m)}
                        for i, m in enumerate(messages)]}


def _hired(**data):
    base = {"applicationId": APP_ID, "jobId": "j-1", "email": "Nuevo@Mail.com",
            "firstName": "Nuevo", "lastName": "Ingreso", "positionTitle": "Dev",
            "startDate": "2026-12-01"}
    return {"eventType": "CandidateHired", "tenantId": "acme", "data": {**base, **data}}


def test_tenant_created_creates_schema(db):
    result = on_tenant_created.handler(_sqs({"eventType": "TenantCreated", "tenantId": "initech",
                                             "data": {}}), None)
    assert result == {"batchItemFailures": []}
    [(tenant, sql)] = db.schemas
    assert tenant == "initech" and "CREATE TABLE IF NOT EXISTS employees" in sql


def test_candidate_hired_creates_employee(db, published):
    assert on_candidate_hired.handler(_sqs(_hired()), None) == {"batchItemFailures": []}
    [emp] = db.data["acme"]["employees"].values()
    assert emp["email"] == "nuevo@mail.com"
    assert emp["document_number"] == "PEND-3f6c0e0a1111422"
    assert emp["hire_date"] == date(2026, 12, 1) and emp["salary"] == Decimal("0.00")
    [event] = published()
    assert event["eventType"] == "EmployeeCreated" and event["data"]["email"] == "nuevo@mail.com"


def test_candidate_hired_is_idempotent(db, published):
    on_candidate_hired.handler(_sqs(_hired()), None)
    on_candidate_hired.handler(_sqs(_hired()), None)
    assert len(db.data["acme"]["employees"]) == 1
    assert [e["eventType"] for e in published()] == ["EmployeeCreated", "EmployeeCreated"]


def test_candidate_hired_matches_position(db, make_event):
    dep = json.loads(departments.create_department(
        make_event(auth=ADMIN, body={"name": "TI"}), None)["body"])
    pos = json.loads(positions.create_position(
        make_event(auth=ADMIN, body={"title": "Dev", "departmentId": dep["id"]}), None)["body"])
    on_candidate_hired.handler(_sqs(_hired(positionTitle="dev", salary=4500)), None)
    [emp] = db.data["acme"]["employees"].values()
    assert emp["position_id"] == pos["id"] and emp["department_id"] == dep["id"]
    assert emp["salary"] == Decimal("4500.00")


def test_candidate_hired_unknown_department_is_ignored(db):
    on_candidate_hired.handler(_sqs(_hired(departmentId="no-existe")), None)
    [emp] = db.data["acme"]["employees"].values()
    assert emp["department_id"] is None


def test_invalid_message_is_reported(db):
    result = on_candidate_hired.handler(_sqs(_hired(email=None), _hired()), None)
    assert result == {"batchItemFailures": [{"itemIdentifier": "m0"}]}
    assert len(db.data["acme"]["employees"]) == 1