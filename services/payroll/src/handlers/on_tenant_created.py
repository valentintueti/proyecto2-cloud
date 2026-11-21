from functools import lru_cache
from pathlib import Path

from common import db_pg
from common.events import sqs_batch


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


@lru_cache(maxsize=1)
def migration_sql():
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise RuntimeError(f"No hay migraciones en {MIGRATIONS_DIR}")
    return "\n;\n".join(file.read_text(encoding="utf-8") for file in files)


@sqs_batch
def handler(message, context):
    if message["eventType"] == "TenantCreated":
        db_pg.create_tenant_schema(message["tenantId"], migration_sql())
