import json

from conftest import PLATFORM_KEY
from src.handlers import tenants

BODY = {"tenantId": "acme", "name": "Acme", "adminEmail": "admin@acme.com",
        "adminPassword": "Secreta123"}


def test_create_tenant(make_event, published):
    resp = tenants.create(make_event(body=BODY, headers={"x-platform-key": PLATFORM_KEY}), None)
    assert resp["statusCode"] == 201
    data = json.loads(resp["body"])
    assert data["tenant"]["tenantId"] == "acme"
    assert data["admin"]["role"] == "ADMIN_RRHH"
    assert "passwordHash" not in data["admin"]
    [event] = published()
    assert event["eventType"] == "TenantCreated" and event["tenantId"] == "acme"


def test_requires_platform_key(make_event):
    assert tenants.create(make_event(body=BODY), None)["statusCode"] == 403
    bad = make_event(body=BODY, headers={"x-platform-key": "otra"})
    assert tenants.create(bad, None)["statusCode"] == 403


def test_duplicate_tenant_is_409(make_event):
    ev = make_event(body=BODY, headers={"x-platform-key": PLATFORM_KEY})
    tenants.create(ev, None)
    assert tenants.create(ev, None)["statusCode"] == 409


def test_invalid_tenant_id_is_400(make_event):
    ev = make_event(body={**BODY, "tenantId": "Acme Corp!"}, headers={"x-platform-key": PLATFORM_KEY})
    assert tenants.create(ev, None)["statusCode"] == 400