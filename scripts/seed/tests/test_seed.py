"""Tests de los seeds: lista base y escritura en DynamoDB con moto (sin AWS ni PostgreSQL)."""
import sys
from collections import Counter
from pathlib import Path

import boto3
import pytest
from boto3.dynamodb.conditions import Key
from moto import mock_aws

SEED_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED_DIR))

import people  # noqa: E402
import seed_employees  # noqa: E402
import seed_identity  # noqa: E402
import seed_notifications  # noqa: E402
import seed_payroll  # noqa: E402
import seed_recruitment  # noqa: E402
import seed_time_leave  # noqa: E402
from context import Context, load_identity_passwords  # noqa: E402

SIZE = 120
TABLES = {"identity": "t-identity", "recruitment": "t-recruitment",
          "time_leave": "t-time-leave", "notifications": "t-notifications"}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for key, value in {"AWS_DEFAULT_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "testing",
                       "AWS_SECRET_ACCESS_KEY": "testing", "AWS_SESSION_TOKEN": "testing",
                       "PASSWORD_ITERATIONS": "1000"}.items():
        monkeypatch.setenv(key, value)


@pytest.fixture
def ctx():
    with mock_aws():
        dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        for service, name in TABLES.items():
            spec = dict(TableName=name, BillingMode="PAY_PER_REQUEST",
                        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"},
                                   {"AttributeName": "SK", "KeyType": "RANGE"}],
                        AttributeDefinitions=[{"AttributeName": a, "AttributeType": "S"} for a in ("PK", "SK")])
            if service == "time_leave":
                spec["AttributeDefinitions"] += [{"AttributeName": a, "AttributeType": "S"}
                                                 for a in ("GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK")]
                spec["GlobalSecondaryIndexes"] = [
                    {"IndexName": g, "KeySchema": [{"AttributeName": f"{g}PK", "KeyType": "HASH"},
                                                   {"AttributeName": f"{g}SK", "KeyType": "RANGE"}],
                     "Projection": {"ProjectionType": "ALL"}} for g in ("GSI1", "GSI2")]
            dynamodb.create_table(**spec)
        yield Context(tables=dict(TABLES), user_password="Secreta123")


def _all(ctx, service, tenant="acme"):
    items, kwargs = [], {"KeyConditionExpression": Key("PK").eq(f"TENANT#{tenant}")}
    table = ctx.table(service)
    while True:
        resp = table.query(**kwargs)
        items += resp["Items"]
        if "LastEvaluatedKey" not in resp:
            return items
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


# ── Lista base ───────────────────────────────────────────────────────────────

def test_company_is_deterministic_and_consistent():
    people.company.cache_clear()
    a = people.company("acme", SIZE)
    people.company.cache_clear()
    b = people.company("acme", SIZE)
    assert [p.email for p in a.people] == [p.email for p in b.people]
    assert [p.id for p in a.people] == [p.id for p in b.people]
    assert [p.full_name for p in a.people] == [p.full_name for p in b.people]
    assert a.person(1).email == "empleado1@acme.com" and a.person(1).role == "MANAGER"
    assert len({p.email for p in a.people}) == SIZE
    assert all(a.manager_of(p).role == "MANAGER" for p in a.people if p.manager_n)
    assert len(a.leaves) == SIZE // 10


def test_tenants_have_different_ids():
    acme, globex = people.company("acme", SIZE), people.company("globex", SIZE)
    assert acme.person(1).id != globex.person(1).id
    assert globex.person(1).email == "empleado1@globex.com"


def test_demo_users_are_active():
    data = people.company("acme", SIZE)
    assert all(data.person(n).termination_date is None for n in range(1, people.DEMO_USERS + 1))


# ── DynamoDB ─────────────────────────────────────────────────────────────────

def test_identity_users_and_password(ctx):
    data = people.company("acme", SIZE)
    assert seed_identity.seed(ctx, data) == SIZE
    users = _all(ctx, "identity")
    assert len(users) == SIZE
    demo = next(u for u in users if u["email"] == "empleado1@acme.com")
    assert demo["status"] == "ACTIVE" and demo["role"] == "MANAGER" and demo["employeeId"] == data.person(1).id
    assert load_identity_passwords().verify_password("Secreta123", demo["passwordHash"])
    assert all("passwordHash" not in u for u in users if u["status"] == "INVITED")
    assert not any(u["email"] == "admin@acme.com" for u in users)


def test_recruitment_jobs_and_applications(ctx):
    data = people.company("acme", SIZE)
    assert seed_recruitment.seed(ctx, data) == SIZE
    items = _all(ctx, "recruitment")
    jobs = [i for i in items if i["SK"].startswith("JOB#")]
    apps = [i for i in items if i["SK"].startswith("APP#")]
    assert len(jobs) == SIZE // 50 and len(apps) == SIZE - SIZE // 50
    job_ids = {j["jobId"] for j in jobs}
    assert all(a["jobId"] in job_ids and a["SK"] == f"APP#{a['jobId']}#{a['applicationId']}" for a in apps)
    assert "HIRED" not in {a["stage"] for a in apps}


def test_time_leave_items_and_indexes(ctx):
    data = people.company("acme", SIZE)
    assert seed_time_leave.seed(ctx, data) == SIZE
    items = _all(ctx, "time_leave")
    kinds = Counter(i["SK"].split("#")[0] for i in items)
    assert kinds["ATT"] == SIZE * 85 // 100 and kinds["LEAVE"] == SIZE // 10
    assert sum(kinds.values()) == SIZE

    leave = data.leaves[0]
    by_employee = ctx.table("time_leave").query(
        IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"TENANT#acme#EMP#{leave.person.email}"))
    assert leave.id in {i["requestId"] for i in by_employee["Items"]}
    by_status = ctx.table("time_leave").query(
        IndexName="GSI2", KeyConditionExpression=Key("GSI2PK").eq(f"TENANT#acme#LEAVE#{leave.status}"))
    assert leave.id in {i["requestId"] for i in by_status["Items"]}

    balance = next(i for i in items if i["SK"].startswith("BALANCE#"))
    assert 0 <= balance["usedDays"] <= balance["vacationDays"] == 30


def test_notifications_one_per_employee(ctx):
    data = people.company("acme", SIZE)
    assert seed_notifications.seed(ctx, data) == SIZE
    items = _all(ctx, "notifications")
    assert len(items) == SIZE
    mine = [i for i in items if i["SK"].startswith("NOTIF#empleado1@acme.com#")]
    assert len(mine) == 1 and mine[0]["read"] is False
    assert {i["type"] for i in items} <= {"WELCOME", "LEAVE_APPROVED", "PAYSLIP_READY"}


def test_reseeding_does_not_duplicate(ctx):
    data = people.company("acme", SIZE)
    for _ in range(2):
        seed_identity.seed(ctx, data)
        seed_time_leave.seed(ctx, data)
    assert len(_all(ctx, "identity")) == SIZE
    assert len(_all(ctx, "time_leave")) == SIZE


def test_tenants_are_isolated(ctx):
    seed_identity.seed(ctx, people.company("acme", SIZE))
    seed_identity.seed(ctx, people.company("globex", SIZE))
    assert all(u["email"].endswith("@globex.com") for u in _all(ctx, "identity", "globex"))
    assert all(u["email"].endswith("@acme.com") for u in _all(ctx, "identity", "acme"))


# ── Filas para RDS (sin base de datos) ───────────────────────────────────────

def test_employee_rows_reference_existing_managers_and_positions():
    data = people.company("acme", SIZE)
    dept_ids = {d.name: d.id for d in data.departments}
    position_ids = {(d.name, p.title): p.id for d in data.departments for p in d.positions}
    rows = seed_employees.employee_rows(data, dept_ids, position_ids)
    ids = {r["id"] for r in rows}
    assert len(rows) == SIZE
    assert all(r["manager_id"] is None or r["manager_id"] in ids for r in rows)
    assert sum(r["manager_id"] is None for r in rows) == len(data.departments)


def test_payslips_use_the_payroll_calculator():
    data = people.company("acme", SIZE)
    rows = seed_payroll.payslip_rows(data, "run-1", "2026-10")
    assert rows and all(r["net"] == r["gross"] - r["pension_deduction"] - r["leave_deduction"] for r in rows)
    assert all(r["document_key"].startswith("tenants/acme/payslips/2026-10/") for r in rows)
    assert len({r["id"] for r in rows}) == len(rows)
