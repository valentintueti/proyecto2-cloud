"""Deja la plataforma lista después del primer deploy. Todos los pasos son idempotentes.

  1. Crea en la RDS las bases de employees y payroll (si no existen).
  2. Aplica las migraciones de employees y payroll para cada tenant de TENANTS.
  3. Crea los tenants en identity con su admin y la contraseña SEED_ADMIN_PASSWORD.
  4. Copia a payroll los perfiles existentes de employees.

Uso, desde la raíz del repo:
    python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
    .venv/bin/python scripts/bootstrap.py
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import boto3
import pg8000.native
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "python"))

from common import db_pg  # noqa: E402
from common.tenant import schema_name  # noqa: E402

DB_NAME = re.compile(r"[a-z_][a-z0-9_]{0,62}")
EMPLOYEE_PAGE_SIZE = 500


def load_env(path: Path) -> None:
    """Carga KEY=VALUE del .env sin pisar variables ya definidas ni cargar valores vacíos."""
    if not path.exists():
        sys.exit(f"Falta {path}: cópialo desde .env.example y complétalo.")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if value and key not in os.environ:
            os.environ[key] = value


def require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"Falta {name} en el .env")
    return value


def stack_outputs(cf, stack: str) -> dict:
    try:
        outputs = cf.describe_stacks(StackName=stack)["Stacks"][0].get("Outputs", [])
    except ClientError as exc:
        sys.exit(f"No se encontró el stack {stack}. ¿Ya lo desplegaste? ({exc})")
    return {o["OutputKey"]: o["OutputValue"] for o in outputs}


def connect(host: str, port: int, database: str):
    return pg8000.native.Connection(
        user=require("DB_USER"), password=require("DB_PASSWORD"),
        host=host, port=port, database=database, timeout=15,
    )


def ensure_database(host: str, port: int, name: str) -> None:
    if not DB_NAME.fullmatch(name):
        sys.exit(f"Nombre de base inválido: {name!r}")
    conn = connect(host, port, "postgres")
    try:
        if conn.run("SELECT 1 FROM pg_database WHERE datname = :name", name=name):
            print(f"  {name}: ya existía")
            return
        conn.run(f'CREATE DATABASE "{name}"')  # fuera de transacción: pg8000.native es autocommit
        print(f"  {name}: creada")
    finally:
        conn.close()


def create_tenant(identity_url: str, platform_key: str, tenant: str, password: str) -> str:
    body = json.dumps({
        "tenantId": tenant,
        "name": tenant.title(),
        "adminEmail": f"admin@{tenant}.com",
        "adminName": "Administrador RRHH",
        "adminPassword": password,
    }).encode()
    request = urllib.request.Request(
        f"{identity_url.rstrip('/')}/tenants", data=body, method="POST",
        headers={"Content-Type": "application/json", "x-platform-key": platform_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            return "creado"
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            return "ya existía"
        sys.exit(f"Error creando {tenant}: HTTP {exc.code} {exc.read().decode(errors='replace')}")


def migration_sql(service: str) -> str:
    directory = ROOT / "services" / service / "migrations"
    files = sorted(directory.glob("*.sql"))
    if not files:
        raise RuntimeError(f"No hay migraciones en {directory}")
    return "\n;\n".join(f.read_text(encoding="utf-8") for f in files)


def apply_migrations(service: str, database: str, tenants: list[str]) -> None:
    sql = migration_sql(service)
    for tenant in tenants:
        db_pg.create_tenant_schema(tenant, sql, db_name=database)
        print(f"  {database}.{schema_name(tenant)}: migrado")


def ensure_company_names(payroll_db: str, tenants: list[str]) -> None:
    """Nombre de empresa para las boletas de los tenants creados antes de 003_company.sql.
    Usa el mismo nombre que create_tenant registra en identity y no pisa uno existente."""
    for tenant in tenants:
        with db_pg.with_tenant(tenant, db_name=payroll_db) as conn:
            conn.run("""
                INSERT INTO company_profile (id, name) VALUES (TRUE, :name)
                ON CONFLICT (id) DO NOTHING
                """, name=tenant.title())


def sync_payroll_employees(tenant: str, employees_db: str, payroll_db: str) -> int:
    after = None
    reviewed = 0
    while True:
        with db_pg.with_tenant(tenant, db_name=employees_db) as conn:
            [page] = db_pg.query(conn, """
                SELECT (array_agg(employee_id ORDER BY employee_id DESC))[1] AS last_id,
                       CAST(jsonb_agg(snapshot) AS TEXT) AS payload,
                       count(*) AS size
                FROM (
                    SELECT id AS employee_id, email, first_name || ' ' || last_name AS full_name,
                           salary AS base_salary, hire_date, termination_date, status, updated_at
                    FROM employees
                    WHERE CAST(:after AS UUID) IS NULL OR id > :after
                    ORDER BY id LIMIT :limit
                ) snapshot
                """, after=after, limit=EMPLOYEE_PAGE_SIZE)
        if not page["size"]:
            return reviewed

        with db_pg.with_tenant(tenant, db_name=payroll_db) as conn:
            conn.run("""
                INSERT INTO payroll_employees (
                    employee_id, email, full_name, base_salary, hire_date, termination_date, status, updated_at
                )
                SELECT employee_id, email, full_name, base_salary, hire_date, termination_date, status, updated_at
                FROM jsonb_to_recordset(CAST(:payload AS JSONB)) AS employee(
                    employee_id UUID, email TEXT, full_name TEXT, base_salary NUMERIC,
                    hire_date DATE, termination_date DATE, status TEXT, updated_at TIMESTAMPTZ
                )
                ON CONFLICT (employee_id) DO UPDATE SET
                    email = EXCLUDED.email,
                    full_name = EXCLUDED.full_name,
                    base_salary = EXCLUDED.base_salary,
                    hire_date = EXCLUDED.hire_date,
                    updated_at = EXCLUDED.updated_at
                WHERE payroll_employees.updated_at < EXCLUDED.updated_at
                """, payload=page["payload"])
            # Termination is independent of the profile timestamp used for salary updates.
            conn.run("""
                UPDATE payroll_employees AS p
                SET status = 'TERMINATED', termination_date = source.termination_date
                FROM jsonb_to_recordset(CAST(:payload AS JSONB)) AS source(
                    employee_id UUID, status TEXT, termination_date DATE
                )
                WHERE p.employee_id = source.employee_id AND source.status = 'TERMINATED'
                  AND p.status <> 'TERMINATED'
                """, payload=page["payload"])
        after = page["last_id"]
        reviewed += page["size"]


def main() -> None:
    load_env(ROOT / ".env")
    stage = os.environ.get("STAGE", "dev")
    region = os.environ.get("AWS_REGION", "us-east-1")
    tenants = list(dict.fromkeys(t.strip() for t in require("TENANTS").split(",") if t.strip()))
    if not tenants:
        sys.exit("TENANTS debe incluir al menos una empresa")
    for tenant in tenants:
        schema_name(tenant)
    password = require("SEED_ADMIN_PASSWORD")
    platform_key = require("PLATFORM_ADMIN_KEY")
    if len(password) < 8:
        sys.exit("SEED_ADMIN_PASSWORD debe tener al menos 8 caracteres")

    cf = boto3.client("cloudformation", region_name=region)
    infra = stack_outputs(cf, f"hcm-infra-{stage}")
    identity = stack_outputs(cf, f"hcm-identity-{stage}")
    host, port = infra["DbHost"], int(infra.get("DbPort", 5432))
    employees_db = os.environ.get("DB_EMPLOYEES_NAME", "hcm_employees")
    payroll_db = os.environ.get("DB_PAYROLL_NAME", "hcm_payroll")

    print(f"1/4 Bases en {host}")
    for name in (employees_db, payroll_db):
        ensure_database(host, port, name)

    # Prepare schemas before creating tenants, which also publish TenantCreated.
    print("2/4 Migraciones por tenant")
    os.environ.update({"DB_HOST": host, "DB_PORT": str(port)})
    for service, database in (("employees", employees_db), ("payroll", payroll_db)):
        apply_migrations(service, database, tenants)
    ensure_company_names(payroll_db, tenants)

    print(f"3/4 Tenants en {identity['ServiceEndpoint']}")
    for tenant in tenants:
        status = create_tenant(identity["ServiceEndpoint"], platform_key, tenant, password)
        print(f"  {tenant}: {status} (admin@{tenant}.com)")

    print("4/4 Empleados existentes en Payroll")
    for tenant in tenants:
        reviewed = sync_payroll_employees(tenant, employees_db, payroll_db)
        print(f"  {tenant}: {reviewed} empleados revisados")

    print("\nListo. Inicia sesión con código de empresa = tenant, admin@<tenant>.com y SEED_ADMIN_PASSWORD.")


if __name__ == "__main__":
    main()
