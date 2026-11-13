"""Deja la plataforma lista después del primer deploy. Todos los pasos son idempotentes.

  1. Crea en la RDS las bases de employees y payroll (si no existen).
  2. Crea los tenants de TENANTS con POST /tenants de identity, cada uno con su admin
     admin@<tenant>.com y la contraseña SEED_ADMIN_PASSWORD.
  3. Verifica que cada tenant tenga su schema en la base de employees. Lo crea el evento
     TenantCreated; si no aparece a tiempo (p. ej. el tenant ya existía antes de desplegar
     employees), aplica la migración directamente.

Uso, desde la raíz del repo:
    python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
    .venv/bin/python scripts/bootstrap.py
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import boto3
import pg8000.native
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "python"))

from common import db_pg  # noqa: E402

DB_NAME = re.compile(r"[a-z_][a-z0-9_]{0,62}")
SCHEMA_WAIT_SECONDS = 60


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


def existing_schemas(host: str, port: int, database: str) -> set:
    conn = connect(host, port, database)
    try:
        rows = conn.run("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%'")
        return {row[0] for row in rows}
    finally:
        conn.close()


def migration_sql() -> str:
    files = sorted((ROOT / "services" / "employees" / "migrations").glob("*.sql"))
    return "\n;\n".join(f.read_text(encoding="utf-8") for f in files)


def ensure_schemas(host: str, port: int, database: str, tenants: list) -> None:
    expected = {f"tenant_{t}": t for t in tenants}
    deadline = time.time() + SCHEMA_WAIT_SECONDS
    missing = set(expected) - existing_schemas(host, port, database)
    while missing and time.time() < deadline:
        print(f"  esperando TenantCreated: {', '.join(sorted(missing))}")
        time.sleep(5)
        missing -= existing_schemas(host, port, database)

    if missing:
        os.environ.update({"DB_HOST": host, "DB_PORT": str(port)})
        sql = migration_sql()
        for schema in sorted(missing):
            db_pg.create_tenant_schema(expected[schema], sql, db_name=database)
            print(f"  {schema}: creado directamente con la migración")
    for schema in sorted(set(expected) - missing):
        print(f"  {schema}: ok")


def main() -> None:
    load_env(ROOT / ".env")
    stage = os.environ.get("STAGE", "dev")
    region = os.environ.get("AWS_REGION", "us-east-1")
    tenants = [t.strip() for t in require("TENANTS").split(",") if t.strip()]
    password = require("SEED_ADMIN_PASSWORD")
    if len(password) < 8:
        sys.exit("SEED_ADMIN_PASSWORD debe tener al menos 8 caracteres")

    cf = boto3.client("cloudformation", region_name=region)
    infra = stack_outputs(cf, f"hcm-infra-{stage}")
    identity = stack_outputs(cf, f"hcm-identity-{stage}")
    host, port = infra["DbHost"], int(infra.get("DbPort", 5432))
    employees_db = os.environ.get("DB_EMPLOYEES_NAME", "hcm_employees")
    payroll_db = os.environ.get("DB_PAYROLL_NAME", "hcm_payroll")

    print(f"1/3 Bases en {host}")
    for name in (employees_db, payroll_db):
        ensure_database(host, port, name)

    print(f"2/3 Tenants en {identity['ServiceEndpoint']}")
    for tenant in tenants:
        status = create_tenant(identity["ServiceEndpoint"], require("PLATFORM_ADMIN_KEY"), tenant, password)
        print(f"  {tenant}: {status} (admin@{tenant}.com)")

    print(f"3/3 Schemas en {employees_db}")
    ensure_schemas(host, port, employees_db, tenants)

    print("\nListo. Inicia sesión con código de empresa = tenant, admin@<tenant>.com y SEED_ADMIN_PASSWORD.")


if __name__ == "__main__":
    main()
