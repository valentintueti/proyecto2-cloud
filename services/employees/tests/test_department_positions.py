import json
import uuid

from conftest import ADMIN, as_user
from src.handlers import departments, positions


def body(resp):
    return json.loads(resp["body"])


def _department(make_event, name):
    resp = departments.create_department(make_event(auth=ADMIN, body={"name": name}), None)
    assert resp["statusCode"] == 201, resp["body"]
    return body(resp)


def test_departments(db, make_event):
    _department(make_event, "Finanzas")
    dup = departments.create_department(make_event(auth=ADMIN, body={"name": "Finanzas"}), None)
    assert dup["statusCode"] == 409

    listed = body(departments.list_departments(make_event(auth=as_user("EMPLOYEE", "x@acme.com")), None))
    assert [d["name"] for d in listed["items"]] == ["Finanzas"]

    manager = as_user("MANAGER", "jefe@acme.com")
    assert departments.create_department(make_event(auth=manager, body={"name": "TI"}), None)["statusCode"] == 403
    assert departments.create_department(make_event(auth=ADMIN, body={}), None)["statusCode"] == 400


def test_positions(db, make_event):
    ti, rrhh = _department(make_event, "TI"), _department(make_event, "RRHH")

    def create(data):
        return positions.create_position(make_event(auth=ADMIN, body=data), None)

    dev = create({"title": "Dev", "departmentId": ti["id"], "minSalary": 3000, "maxSalary": 6000})
    assert dev["statusCode"] == 201 and body(dev)["departmentName"] == "TI"
    assert create({"title": "Analista", "departmentId": rrhh["id"]})["statusCode"] == 201
    assert create({"title": "X", "departmentId": ti["id"], "minSalary": 9, "maxSalary": 1})["statusCode"] == 400
    assert create({"title": "X", "departmentId": str(uuid.uuid4())})["statusCode"] == 400

    listed = body(positions.list_positions(make_event(auth=ADMIN, query={"departmentId": ti["id"]}), None))
    assert [p["title"] for p in listed["items"]] == ["Dev"]
    everything = body(positions.list_positions(make_event(auth=ADMIN), None))
    assert len(everything["items"]) == 2