import json
import uuid

import pytest

from conftest import ADMIN, as_user
from src.handlers import employees


def body(resp):
    return json.loads(resp["body"])


# ── Crear ────────────────────────────────────────────────────────────────────

def test_create_employee_publishes_event(create_employee, published):
    emp = create_employee(email="Ana@Acme.com")
    assert emp["email"] == "ana@acme.com" and emp["status"] == "ACTIVE"
    [event] = published()
    assert event["eventType"] == "EmployeeCreated" and event["tenantId"] == "acme"
    assert event["data"] == {"employeeId": emp["id"], "email": "ana@acme.com",
                             "fullName": f"{emp['firstName']} {emp['lastName']}",
                             "hireDate": "2025-01-15"}


def test_create_with_manager_includes_manager_email(create_employee, published):
    boss = create_employee(email="jefe@acme.com")
    published()
    create_employee(managerId=boss["id"])
    [event] = published()
    assert event["data"]["managerEmail"] == "jefe@acme.com"


def test_create_validations(db, make_event, employee_body):
    def post(**overrides):
        return employees.create_employee(
            make_event(body=employee_body(**overrides), auth=ADMIN), None)["statusCode"]

    assert post(salary=-1) == 400
    assert post(hireDate="15/01/2025") == 400
    assert post(email="no-es-email") == 400
    assert post(status="TERMINATED") == 400
    assert post(departmentId=str(uuid.uuid4())) == 400   # departamento inexistente


def test_duplicate_email_or_document_is_409(create_employee, make_event, employee_body):
    create_employee(email="dup@acme.com", documentNumber="D1")
    for overrides in ({"email": "dup@acme.com"}, {"documentNumber": "D1"}):
        resp = employees.create_employee(make_event(body=employee_body(**overrides), auth=ADMIN), None)
        assert resp["statusCode"] == 409


@pytest.mark.parametrize("role", ["MANAGER", "EMPLOYEE"])
def test_only_admin_creates(db, make_event, employee_body, role):
    resp = employees.create_employee(
        make_event(body=employee_body(), auth=as_user(role, "x@acme.com")), None)
    assert resp["statusCode"] == 403


# ── Listar ───────────────────────────────────────────────────────────────────

def test_list_pagination_and_search(create_employee, make_event):
    for last_name in ("Zapata", "Alvarez", "Mendoza"):
        create_employee(lastName=last_name)
    page = body(employees.list_employees(make_event(auth=ADMIN, query={"limit": "2"}), None))
    assert page["total"] == 3 and [e["lastName"] for e in page["items"]] == ["Alvarez", "Mendoza"]
    page = body(employees.list_employees(make_event(auth=ADMIN, query={"limit": "2", "offset": "2"}), None))
    assert [e["lastName"] for e in page["items"]] == ["Zapata"]
    found = body(employees.list_employees(make_event(auth=ADMIN, query={"q": "zap"}), None))
    assert [e["lastName"] for e in found["items"]] == ["Zapata"]


@pytest.mark.parametrize("query", [
    {"limit": "0"}, {"offset": "-1"}, {"status": "FIRED"}, {"departmentId": "x"},
])
def test_list_invalid_params(db, make_event, query):
    assert employees.list_employees(make_event(auth=ADMIN, query=query), None)["statusCode"] == 400


def test_manager_sees_only_team(create_employee, make_event):
    boss = create_employee(email="jefe@acme.com")
    report = create_employee(managerId=boss["id"])
    create_employee()
    page = body(employees.list_employees(make_event(auth=as_user("MANAGER", "jefe@acme.com")), None))
    assert [e["id"] for e in page["items"]] == [report["id"]] and page["total"] == 1


def test_manager_without_employee_record_sees_nothing(create_employee, make_event):
    create_employee()
    page = body(employees.list_employees(make_event(auth=as_user("MANAGER", "nuevo@acme.com")), None))
    assert page == {"items": [], "total": 0, "limit": 20, "offset": 0}


def test_employee_cannot_list(db, make_event):
    resp = employees.list_employees(make_event(auth=as_user("EMPLOYEE", "x@acme.com")), None)
    assert resp["statusCode"] == 403


# ── Ver ficha ────────────────────────────────────────────────────────────────

def test_get_permissions(create_employee, make_event):
    boss = create_employee(email="jefe@acme.com")
    me = create_employee(email="yo@acme.com", managerId=boss["id"])
    other = create_employee()
    employee, manager = as_user("EMPLOYEE", "yo@acme.com"), as_user("MANAGER", "jefe@acme.com")

    def get(emp_id, auth):
        return employees.get_employee(make_event(auth=auth, path={"id": emp_id}), None)["statusCode"]

    assert get(me["id"], employee) == 200
    assert get(other["id"], employee) == 403
    assert get(me["id"], manager) == 200
    assert get(boss["id"], manager) == 200       # su propia ficha
    assert get(other["id"], manager) == 403
    assert get(other["id"], ADMIN) == 200


def test_get_invalid_or_missing(db, make_event):
    def get(emp_id):
        return employees.get_employee(make_event(auth=ADMIN, path={"id": emp_id}), None)["statusCode"]

    assert get("no-es-uuid") == 400
    assert get(str(uuid.uuid4())) == 404


# ── Editar ───────────────────────────────────────────────────────────────────

def test_update(create_employee, make_event):
    emp = create_employee(phone="999")
    resp = employees.update_employee(make_event(
        auth=ADMIN, path={"id": emp["id"]}, body={"salary": 4200.5, "phone": None}), None)
    assert resp["statusCode"] == 200
    assert body(resp)["salary"] == 4200.5 and body(resp)["phone"] is None


def test_update_rules(create_employee, make_event):
    emp = create_employee()

    def patch(data, emp_id=emp["id"]):
        return employees.update_employee(
            make_event(auth=ADMIN, path={"id": emp_id}, body=data), None)["statusCode"]

    assert patch({"email": "otro@acme.com"}) == 400
    assert patch({"status": "TERMINATED"}) == 400
    assert patch({"managerId": emp["id"]}) == 400
    assert patch({}) == 400
    assert patch({"salary": 1}, emp_id=str(uuid.uuid4())) == 404


# ── Dar de baja ──────────────────────────────────────────────────────────────

def test_terminate(create_employee, make_event, published):
    emp = create_employee()
    published()  # descarta EmployeeCreated

    def terminate(day):
        return employees.terminate_employee(make_event(
            auth=ADMIN, path={"id": emp["id"]}, body={"terminationDate": day}), None)

    assert terminate("2024-12-31")["statusCode"] == 400     # antes de hireDate
    resp = terminate("2026-11-30")
    assert resp["statusCode"] == 200 and body(resp)["status"] == "TERMINATED"
    [event] = published()
    assert event["eventType"] == "EmployeeTerminated"
    assert event["data"] == {"employeeId": emp["id"], "email": emp["email"],
                             "terminationDate": "2026-11-30"}
    assert terminate("2026-12-01")["statusCode"] == 409
    edit = employees.update_employee(make_event(
        auth=ADMIN, path={"id": emp["id"]}, body={"salary": 1}), None)
    assert edit["statusCode"] == 409


def test_admin_cannot_terminate_self(create_employee, make_event):
    me = create_employee(email="admin@acme.com")
    resp = employees.terminate_employee(make_event(
        auth=ADMIN, path={"id": me["id"]}, body={"terminationDate": "2026-11-30"}), None)
    assert resp["statusCode"] == 400


# ── Multi-tenant ─────────────────────────────────────────────────────────────

def test_tenant_isolation(create_employee, make_event):
    emp = create_employee()
    globex = as_user("ADMIN_RRHH", "admin@globex.com", tenant="globex")
    resp = employees.get_employee(make_event(auth=globex, path={"id": emp["id"]}), None)
    assert resp["statusCode"] == 404
    assert body(employees.list_employees(make_event(auth=globex), None))["total"] == 0