from common.db_dynamo import TenantTable
from src import repository as repo
from src.handlers import users

NEW = {"email": "luis@acme.com", "name": "Luis", "role": "MANAGER", "password": "Secreta123"}


def _delete(make_event, auth, email):
    return users.delete_user(make_event(auth=auth, path={"email": email}), None)


def test_delete_user(admin, make_event):
    users.create_user(make_event(body=NEW, auth=admin), None)
    resp = _delete(make_event, admin, "luis%40acme.com")
    assert resp["statusCode"] == 204
    assert resp["body"] == ""
    assert TenantTable("acme").get(repo.user_sk("luis@acme.com")) is None


def test_delete_user_inexistente_es_404(admin, make_event):
    assert _delete(make_event, admin, "nadie@acme.com")["statusCode"] == 404


def test_admin_no_puede_borrarse_a_si_mismo(admin, make_event):
    assert _delete(make_event, admin, "admin@acme.com")["statusCode"] == 400
    assert _delete(make_event, admin, "ADMIN%40acme.com")["statusCode"] == 400
    assert TenantTable("acme").get(repo.user_sk("admin@acme.com")) is not None


def test_usuario_vinculado_a_empleado_es_409(admin, make_event):
    users.create_user(make_event(body={**NEW, "employeeId": "e-1"}, auth=admin), None)
    resp = _delete(make_event, admin, "luis@acme.com")
    assert resp["statusCode"] == 409
    assert "empleado" in resp["body"]
    assert TenantTable("acme").get(repo.user_sk("luis@acme.com")) is not None


def test_delete_user_de_otro_tenant_es_404(create_tenant, make_event):
    acme = create_tenant("acme")
    globex = create_tenant("globex")
    users.create_user(make_event(body=NEW, auth=acme), None)
    assert _delete(make_event, globex, "luis@acme.com")["statusCode"] == 404
    assert TenantTable("acme").get(repo.user_sk("luis@acme.com")) is not None


def test_delete_user_solo_admin(admin, make_event):
    users.create_user(make_event(body=NEW, auth=admin), None)
    manager = {**admin, "userId": "jefe@acme.com", "role": "MANAGER"}
    assert _delete(make_event, manager, "luis@acme.com")["statusCode"] == 403


def test_email_invalido_es_400(admin, make_event):
    assert _delete(make_event, admin, "no-es-email")["statusCode"] == 400
