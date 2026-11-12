"""PostgreSQL (RDS) con aislamiento por schema: Patrón 2, Single Database / Multiple Schemas."""
import os
from contextlib import contextmanager

import pg8000.native
from pg8000.exceptions import InterfaceError

from .tenant import schema_name

# Una conexión por base, reutilizada entre invocaciones de la misma Lambda.
_connections: dict = {}


def _db_name(db_name: str | None) -> str:
    name = db_name or os.environ.get("DB_NAME")
    if not name:
        raise RuntimeError("Falta la variable de entorno DB_NAME")
    return name


def _connect(db_name: str):
    return pg8000.native.Connection(
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        database=db_name,
        timeout=10,
    )


def _drop(name: str) -> None:
    conn = _connections.pop(name, None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def _begin(name: str):
    """Abre una transacción. Si la conexión cacheada murió (p. ej. RDS se
    reinició), reconecta una vez."""
    for attempt in range(2):
        conn = _connections.get(name)
        if conn is None:
            conn = _connections[name] = _connect(name)
        try:
            conn.run("START TRANSACTION")
            return conn
        except InterfaceError:
            _drop(name)
            if attempt == 1:
                raise
    raise RuntimeError("No se pudo abrir la transacción")


@contextmanager
def _transaction(name: str, schema: str):
    conn = _begin(name)
    try:
        # SET LOCAL dura solo esta transacción: si la misma Lambda atiende luego
        # a otro tenant, no hereda este search_path.
        conn.run(f'SET LOCAL search_path TO "{schema}"')
        yield conn
        conn.run("COMMIT")
    except Exception:
        try:
            conn.run("ROLLBACK")
        except Exception:
            _drop(name)
        raise


def with_tenant(tenant_id: str, db_name: str | None = None):
    """Uso:
        with with_tenant(tenant_id) as conn:
            rows = query(conn, "SELECT * FROM employees WHERE id = :id", id=5)
    Valida el tenant ANTES de conectarse."""
    schema = schema_name(tenant_id)
    return _transaction(_db_name(db_name), schema)


def rows_to_dicts(conn, rows) -> list[dict]:
    if not conn.columns:
        return []
    names = [col["name"] for col in conn.columns]
    return [dict(zip(names, row)) for row in rows]


def query(conn, sql: str, **params) -> list[dict]:
    """Ejecuta SQL con parámetros nombrados (:nombre) y devuelve filas como dicts."""
    rows = conn.run(sql, **params)
    return rows_to_dicts(conn, rows or [])


def split_sql(script: str) -> list[str]:
    """Separa un archivo de migración en sentencias. Ignora comentarios '--'.
    Limitación: no soporta ';' dentro de strings ni funciones PL/pgSQL."""
    lines = [line for line in script.splitlines() if not line.strip().startswith("--")]
    return [stmt.strip() for stmt in "\n".join(lines).split(";") if stmt.strip()]


def create_tenant_schema(tenant_id: str, migration_sql: str, db_name: str | None = None) -> None:
    """Crea el schema del tenant y aplica la migración dentro de él.
    Usa CREATE TABLE IF NOT EXISTS en las migraciones para que sea idempotente."""
    schema = schema_name(tenant_id)
    with _transaction(_db_name(db_name), schema) as conn:
        conn.run(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        for statement in split_sql(migration_sql):
            conn.run(statement)