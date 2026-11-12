"""Consumidor SQS: crea el schema del tenant nuevo y aplica las migraciones."""
import logging
from pathlib import Path

from common import db_pg
from common.events import sqs_batch

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
_migration_sql = None


def migration_sql() -> str:
    """Todas las migraciones en orden (001_, 002_, ...), en un solo script."""
    global _migration_sql
    if _migration_sql is None:
        files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        if not files:
            raise RuntimeError(f"No hay migraciones en {MIGRATIONS_DIR}")
        _migration_sql = "\n;\n".join(f.read_text(encoding="utf-8") for f in files)
    return _migration_sql


@sqs_batch
def handler(message, context):
    if message["eventType"] != "TenantCreated":
        logger.info("Evento ignorado: %s", message["eventType"])
        return
    db_pg.create_tenant_schema(message["tenantId"], migration_sql())
    logger.info("Schema creado para el tenant %s", message["tenantId"])