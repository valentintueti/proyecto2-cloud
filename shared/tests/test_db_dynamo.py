from decimal import Decimal

import boto3
import pytest
from moto import mock_aws

from common.db_dynamo import TenantTable
from common.tenant import TenantError


@pytest.fixture
def table(monkeypatch):
    with mock_aws():
        boto3.resource("dynamodb").create_table(
            TableName="hcm-test",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        monkeypatch.setenv("TABLE_NAME", "hcm-test")
        yield


def test_put_y_get_con_float(table):
    acme = TenantTable("acme")
    acme.put("EMP#1", {"name": "Ana", "salary": 2500.5})
    item = acme.get("EMP#1")
    assert item["PK"] == "TENANT#acme"
    assert item["tenantId"] == "acme"
    assert item["salary"] == Decimal("2500.5")


def test_un_tenant_no_ve_datos_de_otro(table):
    acme, globex = TenantTable("acme"), TenantTable("globex")
    acme.put("USER#ana@acme.com", {"name": "Ana"})
    globex.put("USER#bob@globex.com", {"name": "Bob"})

    items, _ = acme.query("USER#")
    assert [i["name"] for i in items] == ["Ana"]
    assert acme.get("USER#bob@globex.com") is None


def test_paginacion_y_cursor_de_otro_tenant(table):
    acme = TenantTable("acme")
    for n in range(3):
        acme.put(f"EMP#{n}", {"n": n})

    first, cursor = acme.query("EMP#", limit=2)
    assert len(first) == 2 and cursor is not None
    rest, last_cursor = acme.query("EMP#", limit=2, cursor=cursor)
    assert len(rest) == 1 and last_cursor is None

    with pytest.raises(ValueError):
        TenantTable("globex").query("EMP#", cursor=cursor)
    with pytest.raises(ValueError):
        acme.query("EMP#", cursor="basura!!")


def test_put_if_not_exists(table):
    acme = TenantTable("acme")
    acme.put("USER#ana", {"name": "Ana"}, if_not_exists=True)
    with pytest.raises(ValueError, match="Ya existe"):
        acme.put("USER#ana", {"name": "Otra"}, if_not_exists=True)


def test_update(table):
    acme = TenantTable("acme")
    acme.put("LEAVE#1", {"status": "PENDING"})
    assert acme.update("LEAVE#1", {"status": "APPROVED", "days": 2.5})["status"] == "APPROVED"
    assert acme.update("LEAVE#no-existe", {"status": "APPROVED"}) is None
    with pytest.raises(ValueError):
        acme.update("LEAVE#1", {"tenantId": "globex"})


def test_delete(table):
    acme = TenantTable("acme")
    acme.put("EMP#1", {"name": "Ana"})
    acme.delete("EMP#1")
    assert acme.get("EMP#1") is None


def test_tenant_invalido():
    with pytest.raises(TenantError):
        TenantTable("acme; DROP")