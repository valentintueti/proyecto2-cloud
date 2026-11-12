import json

from src.handlers import auth, users

NEW = {"email": "luis@acme.com", "name": "Luis", "role": "MANAGER", "password": "Secreta123"}


def test_create_and_list(admin, make_event):
    resp = users.create_user(make_event(body=NEW, auth=admin), None)
    assert resp["statusCode"] == 201
    listed = json.loads(users.list_users(make_event(auth=admin), None)["body"])
    emails = {u["email"] for u in listed["items"]}
    assert emails == {"admin@acme.com", "luis@acme.com"}
    assert all("passwordHash" not in u for u in listed["items"])


def test_duplicate_user_is_409(admin, make_event):
    users.create_user(make_event(body=NEW, auth=admin), None)
    assert users.create_user(make_event(body=NEW, auth=admin), None)["statusCode"] == 409


def test_non_admin_forbidden(admin, make_event):
    employee = {**admin, "userId": "x@acme.com", "role": "EMPLOYEE"}
    assert users.list_users(make_event(auth=employee), None)["statusCode"] == 403
    assert users.create_user(make_event(body=NEW, auth=employee), None)["statusCode"] == 403


def test_tenant_isolation(create_tenant, make_event):
    acme = create_tenant("acme")
    globex = create_tenant("globex")
    users.create_user(make_event(body=NEW, auth=acme), None)
    listed = json.loads(users.list_users(make_event(auth=globex), None)["body"])
    assert {u["email"] for u in listed["items"]} == {"admin@globex.com"}


def test_update_role_and_disable(admin, make_event):
    users.create_user(make_event(body=NEW, auth=admin), None)
    resp = users.update_user(make_event(
        body={"role": "EMPLOYEE", "status": "DISABLED"}, auth=admin,
        path={"email": "luis%40acme.com"}), None)
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["role"] == "EMPLOYEE"
    login = auth.login(make_event(body={"tenantId": "acme", "email": "luis@acme.com",
                                        "password": "Secreta123"}), None)
    assert login["statusCode"] == 401


def test_update_validation(admin, make_event):
    def patch(body, email="admin@acme.com"):
        return users.update_user(make_event(body=body, auth=admin, path={"email": email}), None)

    assert patch({"role": "EMPLOYEE"})["statusCode"] == 400      # no puede degradarse
    assert patch({"tenantId": "globex"})["statusCode"] == 400    # campo no permitido
    assert patch({"name": "X"}, email="nadie@acme.com")["statusCode"] == 404