import json

from common.auth import verify_token
from src.handlers import auth


def _login(make_event, tenant="acme", email="admin@acme.com", password="Secreta123"):
    return auth.login(make_event(body={"tenantId": tenant, "email": email, "password": password}), None)


def test_login_ok(admin, make_event):
    resp = _login(make_event)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    claims = verify_token(data["token"])
    assert claims["tenantId"] == "acme" and claims["role"] == "ADMIN_RRHH"
    assert "passwordHash" not in data["user"]


def test_login_email_case_insensitive(admin, make_event):
    assert _login(make_event, email="  ADMIN@acme.com ")["statusCode"] == 200


def test_wrong_password(admin, make_event):
    assert _login(make_event, password="incorrecta")["statusCode"] == 401


def test_same_email_other_tenant_is_401(admin, make_event):
    assert _login(make_event, tenant="globex")["statusCode"] == 401


def test_bad_tenant_or_email_is_401(admin, make_event):
    assert _login(make_event, tenant="../x")["statusCode"] == 401
    assert _login(make_event, email="no-es-email")["statusCode"] == 401


def test_me(admin, make_event):
    resp = auth.me(make_event(auth=admin), None)
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["email"] == "admin@acme.com"