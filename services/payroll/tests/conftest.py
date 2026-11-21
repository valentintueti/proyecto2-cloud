import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "shared" / "python"))
sys.path.insert(0, str(ROOT / "services" / "payroll"))

from common import db_pg
from common.tenant import schema_name
from src.handlers import on_tenant_created


@pytest.fixture
def payroll_tenants():
    if os.environ.get("PAYROLL_TEST_PG") != "1":
        pytest.skip("Configura PAYROLL_TEST_PG=1 y DB_* para usar PostgreSQL de pruebas")

    prefix = f"paytest_{uuid4().hex[:8]}"
    tenants = [f"{prefix}_a", f"{prefix}_b"]
    created_tenants = []
    try:
        for tenant in tenants:
            event = {"eventType": "TenantCreated", "tenantId": tenant}
            payload = {"Records": [{"messageId": "create-tenant", "body": json.dumps(event)}]}
            assert on_tenant_created.handler(payload, None) == {"batchItemFailures": []}
            created_tenants.append(tenant)
        yield tenants
    finally:
        for tenant in created_tenants:
            with db_pg.with_tenant(tenant) as conn:
                conn.run(f'DROP SCHEMA "{schema_name(tenant)}" CASCADE')
