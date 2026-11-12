import json

from common.db_dynamo import TenantTable
from src.handlers import on_employee_event, users


def _sqs(*messages):
    return {"Records": [{"messageId": f"m{i}", "body": json.dumps(m)}
                        for i, m in enumerate(messages)]}


def _created(email="luis@acme.com"):
    return {"eventType": "EmployeeCreated", "tenantId": "acme",
            "data": {"employeeId": "e-1", "email": email, "fullName": "Luis Ramos"}}


def test_employee_created_creates_invited_user(admin):
    result = on_employee_event.handler(_sqs(_created()), None)
    assert result == {"batchItemFailures": []}
    user = TenantTable("acme").get("USER#luis@acme.com")
    assert user["status"] == "INVITED" and user["role"] == "EMPLOYEE"
    assert user["employeeId"] == "e-1" and "passwordHash" not in user


def test_employee_created_is_idempotent(admin):
    on_employee_event.handler(_sqs(_created(), _created()), None)
    assert on_employee_event.handler(_sqs(_created()), None)["batchItemFailures"] == []


def test_existing_user_gets_linked(admin, make_event):
    users.create_user(make_event(auth=admin, body={
        "email": "luis@acme.com", "name": "Luis", "role": "MANAGER", "password": "Secreta123"}), None)
    on_employee_event.handler(_sqs(_created()), None)
    user = TenantTable("acme").get("USER#luis@acme.com")
    assert user["employeeId"] == "e-1" and user["role"] == "MANAGER"


def test_employee_terminated_disables(admin):
    on_employee_event.handler(_sqs(_created()), None)
    on_employee_event.handler(_sqs({"eventType": "EmployeeTerminated", "tenantId": "acme",
                                    "data": {"employeeId": "e-1", "email": "luis@acme.com"}}), None)
    assert TenantTable("acme").get("USER#luis@acme.com")["status"] == "DISABLED"


def test_bad_message_reported_as_failure(admin):
    bad = {"eventType": "EmployeeCreated", "tenantId": "acme", "data": {"email": "x@acme.com"}}
    result = on_employee_event.handler(_sqs(bad, _created()), None)
    assert result == {"batchItemFailures": [{"itemIdentifier": "m0"}]}