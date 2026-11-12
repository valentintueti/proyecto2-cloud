import json

from common.db_dynamo import TenantTable
from src import repository as repo
from src.handlers import balances


def body(resp):
    return json.loads(resp["body"])


def test_my_balance_sin_registro_devuelve_30_sin_escribir(api_event, at_lima):
    at_lima("2026-11-12T10:00:00")
    resp = balances.my_balance(api_event(), None)
    assert resp["statusCode"] == 200
    assert body(resp) == {
        "email": "ana@acme.com", "year": 2026,
        "vacationDays": 30, "usedDays": 0, "availableDays": 30,
    }
    assert TenantTable("acme").get(repo.balance_sk("ana@acme.com", 2026)) is None


def test_my_balance_con_registro(api_event, at_lima):
    at_lima("2026-11-12T10:00:00")
    TenantTable("acme").put(
        repo.balance_sk("ana@acme.com", 2026),
        {"email": "ana@acme.com", "year": 2026, "vacationDays": 30, "usedDays": 6},
    )
    assert body(balances.my_balance(api_event(), None))["availableDays"] == 24
