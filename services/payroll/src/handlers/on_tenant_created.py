from functools import lru_cache
from pathlib import Path

from common import db_pg
from common.events import sqs_batch
from src import repository as repo


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


@lru_cache(maxsize=1)
def migration_sql():
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise RuntimeError(f"No hay migraciones en {MIGRATIONS_DIR}")
    return "\n;\n".join(file.read_text(encoding="utf-8") for file in files)


@sqs_batch
def handler(message, context):
    if message["eventType"] != "TenantCreated":
        return
    tenant_id = message["tenantId"]
    db_pg.create_tenant_schema(tenant_id, migration_sql())
    name = str((message.get("data") or {}).get("name") or "").strip()[:100]
    if name:
        with db_pg.with_tenant(tenant_id) as conn:
            repo.save_company_name(conn, name)
