import itertools
import json
import sys
import uuid
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "shared" / "python"))
sys.path.insert(0, str(ROOT / "services" / "employees"))

from common.http import ConflictError  # noqa: E402
from common.tenant import schema_name  # noqa: E402

ADMIN = {"tenantId": "acme", "userId": "admin@acme.com", "role": "ADMIN_RRHH"}

REPO_FUNCTIONS = [
    "list_employees", "get_employee", "get_employee_by_email", "insert_employee",
    "update_employee", "terminate_employee", "list_departments", "insert_department",
    "department_exists", "list_positions", "insert_position", "find_position_by_title",
]


def as_user(role, email, tenant="acme"):
    return {"tenantId": tenant, "userId": email, "role": role}


# ── AWS falso (SNS → SQS espía para leer los eventos publicados) ─────────────

@pytest.fixture(autouse=True)
def aws(monkeypatch):
    for k, v in {
        "AWS_ACCESS_KEY_ID": "testing", "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing", "AWS_DEFAULT_REGION": "us-east-1",
        "JWT_SECRET": "test-secret-de-al-menos-32-caracteres-123",
        "SERVICE_NAME": "employees",
    }.items():
        monkeypatch.setenv(k, v)

    from common import db_pg, events
    monkeypatch.setattr(events, "_sns", None)
    monkeypatch.setattr(db_pg, "_connections", {})

    with mock_aws():
        sns, sqs = boto3.client("sns"), boto3.client("sqs")
        topic = sns.create_topic(Name="hcm-events")["TopicArn"]
        queue_url = sqs.create_queue(QueueName="spy")["QueueUrl"]
        queue_arn = sqs.get_queue_attributes(
            QueueUrl=queue_url, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
        sns.subscribe(TopicArn=topic, Protocol="sqs", Endpoint=queue_arn,
                      Attributes={"RawMessageDelivery": "true"})
        monkeypatch.setenv("EVENTS_TOPIC_ARN", topic)
        yield {"sqs": sqs, "queue_url": queue_url}


@pytest.fixture
def published(aws):
    def read():
        resp = aws["sqs"].receive_message(QueueUrl=aws["queue_url"], MaxNumberOfMessages=10)
        return [json.loads(m["Body"]) for m in resp.get("Messages", [])]
    return read


# ── BD falsa en memoria, separada por tenant ─────────────────────────────────

class FakeConn:
    def __init__(self, tenant):
        self.tenant = tenant


class FakeDB:
    def __init__(self):
        self.data = defaultdict(lambda: {"employees": {}, "departments": {}, "positions": {}})
        self.schemas = []

    def _t(self, conn):
        return self.data[conn.tenant]

    @contextmanager
    def with_tenant(self, tenant_id, db_name=None):
        schema_name(tenant_id)  # valida igual que el real
        yield FakeConn(tenant_id)

    def create_tenant_schema(self, tenant_id, migration_sql, db_name=None):
        schema_name(tenant_id)
        self.schemas.append((tenant_id, migration_sql))

    # empleados
    def _decorate(self, t, emp):
        dep = t["departments"].get(emp.get("department_id"))
        pos = t["positions"].get(emp.get("position_id"))
        return {**emp, "department_name": dep["name"] if dep else None,
                "position_title": pos["title"] if pos else None}

    def get_employee(self, conn, employee_id):
        t = self._t(conn)
        emp = t["employees"].get(str(employee_id))
        return self._decorate(t, emp) if emp else None

    def get_employee_by_email(self, conn, email):
        t = self._t(conn)
        for emp in t["employees"].values():
            if emp["email"] == email:
                return self._decorate(t, emp)
        return None

    def insert_employee(self, conn, data):
        t = self._t(conn)
        for emp in t["employees"].values():
            if emp["email"] == data["email"]:
                raise ConflictError("Ya existe un empleado con ese email")
            if emp["document_number"] == data["document_number"]:
                raise ConflictError("Ya existe un empleado con ese documento")
        for column, table in (("department_id", "departments"), ("position_id", "positions"),
                              ("manager_id", "employees")):
            if data.get(column) and data[column] not in t[table]:
                raise ValueError("Referencia inexistente (departamento, puesto o jefe)")
        new_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        t["employees"][new_id] = {
            "id": new_id, "phone": None, "department_id": None, "position_id": None,
            "manager_id": None, "termination_date": None, "status": "ACTIVE",
            "created_at": now, "updated_at": now, **data,
        }
        return self.get_employee(conn, new_id)

    def update_employee(self, conn, employee_id, changes):
        emp = self._t(conn)["employees"].get(employee_id)
        if emp is None:
            return None
        emp.update(changes)
        return self.get_employee(conn, employee_id)

    def terminate_employee(self, conn, employee_id, termination_date):
        emp = self._t(conn)["employees"].get(employee_id)
        if emp is None or emp["status"] != "ACTIVE":
            return None
        emp.update(status="TERMINATED", termination_date=termination_date)
        return self.get_employee(conn, employee_id)

    def list_employees(self, conn, *, limit, offset, department_id=None, status=None,
                       q=None, manager_id=None):
        t = self._t(conn)
        rows = [
            self._decorate(t, e) for e in t["employees"].values()
            if (not department_id or e["department_id"] == department_id)
            and (not status or e["status"] == status)
            and (not manager_id or e["manager_id"] == manager_id)
            and (not q or any(q.lower() in str(e[f]).lower()
                              for f in ("first_name", "last_name", "email")))
        ]
        rows.sort(key=lambda r: (r["last_name"], r["first_name"], r["id"]))
        return rows[offset:offset + limit], len(rows)

    # departamentos
    def list_departments(self, conn):
        return sorted(self._t(conn)["departments"].values(), key=lambda d: d["name"])

    def insert_department(self, conn, data):
        t = self._t(conn)
        if any(d["name"] == data["name"] for d in t["departments"].values()):
            raise ConflictError("Ya existe un departamento con ese nombre")
        new_id = str(uuid.uuid4())
        t["departments"][new_id] = {"id": new_id, "name": data["name"],
                                    "created_at": datetime.now(timezone.utc)}
        return t["departments"][new_id]

    def department_exists(self, conn, department_id):
        return department_id in self._t(conn)["departments"]

    # puestos
    def _position_row(self, t, p):
        return {**p, "department_name": t["departments"][p["department_id"]]["name"]}

    def list_positions(self, conn, department_id=None):
        t = self._t(conn)
        rows = [self._position_row(t, p) for p in t["positions"].values()
                if not department_id or p["department_id"] == department_id]
        return sorted(rows, key=lambda p: p["title"])

    def insert_position(self, conn, data):
        t = self._t(conn)
        if data["department_id"] not in t["departments"]:
            raise ValueError("Referencia inexistente (departamento, puesto o jefe)")
        new_id = str(uuid.uuid4())
        t["positions"][new_id] = {"id": new_id, **data}
        return self._position_row(t, t["positions"][new_id])

    def find_position_by_title(self, conn, title, department_id=None):
        for p in self._t(conn)["positions"].values():
            if p["title"].lower() == title.lower() and (
                    not department_id or p["department_id"] == department_id):
                return {"id": p["id"], "department_id": p["department_id"]}
        return None


@pytest.fixture
def db(monkeypatch):
    from common import db_pg
    from src import repository

    fake = FakeDB()
    monkeypatch.setattr(db_pg, "with_tenant", fake.with_tenant)
    monkeypatch.setattr(db_pg, "create_tenant_schema", fake.create_tenant_schema)
    for name in REPO_FUNCTIONS:  # falla si el repository real no tiene la función
        monkeypatch.setattr(repository, name, getattr(fake, name))
    return fake


# ── Eventos de API Gateway y datos de prueba ─────────────────────────────────

def _event(body=None, auth=None, path=None, query=None, headers=None):
    return {
        "headers": headers or {},
        "pathParameters": path,
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": auth} if auth else {},
    }


@pytest.fixture
def make_event():
    return _event


@pytest.fixture
def employee_body():
    counter = itertools.count(1)

    def _body(**overrides):
        n = next(counter)
        body = {"firstName": f"Nombre{n}", "lastName": f"Apellido{n}",
                "email": f"empleado{n}@acme.com", "documentNumber": f"DOC{n:05d}",
                "hireDate": "2025-01-15", "salary": 3500}
        body.update(overrides)
        return body
    return _body


@pytest.fixture
def create_employee(db, employee_body):
    from src.handlers import employees

    def _create(auth=ADMIN, **overrides):
        resp = employees.create_employee(_event(body=employee_body(**overrides), auth=auth), None)
        assert resp["statusCode"] == 201, resp["body"]
        return json.loads(resp["body"])
    return _create