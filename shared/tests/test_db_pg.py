import pytest
from pg8000.exceptions import InterfaceError

from common import db_pg
from common.tenant import TenantError


class FakeConnection:
    def __init__(self, fail_on=None, error=None):
        self.statements = []
        self.columns = None
        self.fail_on = fail_on
        self.error = error or RuntimeError("falló")

    def run(self, sql, **params):
        self.statements.append(sql)
        if self.fail_on and self.fail_on in sql:
            raise self.error
        return []

    def close(self):
        pass


@pytest.fixture
def fake(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(db_pg, "_connect", lambda name: conn)
    return conn


def test_with_tenant_fija_el_schema_y_hace_commit(fake):
    with db_pg.with_tenant("acme", "hcm_test") as conn:
        conn.run("SELECT 1")
    assert fake.statements == [
        "START TRANSACTION",
        'SET LOCAL search_path TO "tenant_acme"',
        "SELECT 1",
        "COMMIT",
    ]


def test_error_hace_rollback_y_propaga(fake):
    with pytest.raises(ValueError):
        with db_pg.with_tenant("acme", "hcm_test"):
            raise ValueError("dato inválido")
    assert fake.statements[-1] == "ROLLBACK"


def test_tenant_invalido_no_se_conecta(monkeypatch):
    def no_conectar(name):
        raise AssertionError("no debió conectarse")

    monkeypatch.setattr(db_pg, "_connect", no_conectar)
    with pytest.raises(TenantError):
        db_pg.with_tenant('acme"; DROP SCHEMA public; --', "hcm_test")


def test_reutiliza_la_conexion(monkeypatch):
    calls = []

    def connect(name):
        calls.append(name)
        return FakeConnection()

    monkeypatch.setattr(db_pg, "_connect", connect)
    for tenant in ("acme", "globex"):
        with db_pg.with_tenant(tenant, "hcm_test"):
            pass
    assert calls == ["hcm_test"]


def test_reconecta_si_la_conexion_murio(monkeypatch):
    dead = FakeConnection(fail_on="START TRANSACTION", error=InterfaceError("cerrada"))
    alive = FakeConnection()
    conns = iter([dead, alive])
    monkeypatch.setattr(db_pg, "_connect", lambda name: next(conns))

    with db_pg.with_tenant("acme", "hcm_test") as conn:
        assert conn is alive


def test_query_devuelve_dicts():
    conn = FakeConnection()
    conn.columns = [{"name": "id"}, {"name": "name"}]
    conn.run = lambda sql, **params: [[1, "Ana"], [2, "Bob"]]
    assert db_pg.query(conn, "SELECT id, name FROM employees") == [
        {"id": 1, "name": "Ana"},
        {"id": 2, "name": "Bob"},
    ]


def test_split_sql():
    script = """
    -- tablas del tenant
    CREATE TABLE IF NOT EXISTS a (id int);

    CREATE TABLE IF NOT EXISTS b (id int);
    """
    assert db_pg.split_sql(script) == [
        "CREATE TABLE IF NOT EXISTS a (id int)",
        "CREATE TABLE IF NOT EXISTS b (id int)",
    ]


def test_create_tenant_schema(fake):
    db_pg.create_tenant_schema("acme", "CREATE TABLE IF NOT EXISTS a (id int);", "hcm_test")
    assert fake.statements == [
        "START TRANSACTION",
        'SET LOCAL search_path TO "tenant_acme"',
        'CREATE SCHEMA IF NOT EXISTS "tenant_acme"',
        "CREATE TABLE IF NOT EXISTS a (id int)",
        "COMMIT",
    ]