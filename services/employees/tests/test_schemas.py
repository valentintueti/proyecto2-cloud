import uuid
from datetime import date
from decimal import Decimal

import pytest

from src import schemas as s

VALID = {"firstName": " Ana ", "lastName": "Pérez", "email": "ANA@Acme.com",
         "documentNumber": "12345678", "hireDate": "2025-01-15", "salary": "3500.5"}


def test_new_employee_maps_and_normalizes():
    data = s.new_employee(VALID)
    assert data == {"first_name": "Ana", "last_name": "Pérez", "email": "ana@acme.com",
                    "document_number": "12345678", "hire_date": date(2025, 1, 15),
                    "salary": Decimal("3500.50")}


def test_new_employee_missing_and_unknown():
    with pytest.raises(ValueError, match="Faltan campos: salary"):
        s.new_employee({k: v for k, v in VALID.items() if k != "salary"})
    with pytest.raises(ValueError, match="no permitidos"):
        s.new_employee({**VALID, "status": "ACTIVE"})


@pytest.mark.parametrize("field,value", [
    ("email", "no-es-email"), ("hireDate", "15/01/2025"), ("salary", -1),
    ("salary", "abc"), ("salary", "NaN"), ("salary", True), ("salary", 10**9),
    ("departmentId", "123"), ("firstName", "x" * 81),
])
def test_new_employee_invalid_values(field, value):
    with pytest.raises(ValueError):
        s.new_employee({**VALID, field: value})


def test_nullable_fields_accept_none():
    data = s.new_employee({**VALID, "phone": None, "managerId": None})
    assert data["phone"] is None and data["manager_id"] is None


def test_employee_changes():
    assert s.employee_changes({"salary": 10}) == {"salary": Decimal("10.00")}
    for blocked in ({"email": "x@y.com"}, {"status": "TERMINATED"}, {"terminationDate": "2026-01-01"}):
        with pytest.raises(ValueError, match="terminate"):
            s.employee_changes(blocked)
    with pytest.raises(ValueError):
        s.employee_changes({})


def test_list_filters_and_offset():
    dep = str(uuid.uuid4())
    assert s.list_filters({"departmentId": dep, "status": "active", "q": " ana "}) == \
        {"department_id": dep, "status": "ACTIVE", "q": "ana"}
    assert s.list_filters(None) == {}
    for bad in ({"status": "FIRED"}, {"departmentId": "x"}, {"q": "a" * 101}):
        with pytest.raises(ValueError):
            s.list_filters(bad)
    assert s.parse_offset({"offset": "40"}) == 40
    for bad in ({"offset": "-1"}, {"offset": "x"}):
        with pytest.raises(ValueError):
            s.parse_offset(bad)


def test_new_position_salary_range():
    dep = str(uuid.uuid4())
    assert s.new_position({"title": "Dev", "departmentId": dep})["min_salary"] is None
    with pytest.raises(ValueError, match="minSalary"):
        s.new_position({"title": "Dev", "departmentId": dep, "minSalary": 5000, "maxSalary": 3000})


def test_to_api_and_event_data():
    emp_id = uuid.uuid4()
    row = {"id": emp_id, "first_name": "Ana", "last_name": "Pérez", "email": "ana@acme.com",
           "hire_date": date(2025, 1, 15), "department_id": None,
           "termination_date": date(2026, 1, 31)}
    api = s.to_api(row)
    assert api["id"] == str(emp_id) and api["firstName"] == "Ana" and "first_name" not in api
    assert s.employee_created_data(row, "jefe@acme.com") == {
        "employeeId": str(emp_id), "email": "ana@acme.com", "fullName": "Ana Pérez",
        "hireDate": "2025-01-15", "managerEmail": "jefe@acme.com"}
    assert s.employee_terminated_data(row)["terminationDate"] == "2026-01-31"


def test_provisional_document():
    doc = s.provisional_document("3f6c0e0a-1111-4222-8333-444455556666")
    assert doc == "PEND-3f6c0e0a1111422" and len(doc) <= 20
    with pytest.raises(ValueError):
        s.provisional_document("")