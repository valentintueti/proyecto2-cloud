"""Conexiones y nombres de recursos para los seeds.

Lee el .env de la raíz (igual que scripts/bootstrap.py) y toma de CloudFormation los nombres de
tablas, el bucket de boletas y el host de la RDS. Nada se escribe a mano.
"""
import importlib.util
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "shared" / "python"))
sys.path.insert(0, str(ROOT / "scripts"))

import bootstrap  # noqa: E402  (load_env, require, stack_outputs, migration_sql)

TABLES = {  # servicio: (stack sin stage, recurso lógico)
    "identity": ("hcm-identity", "IdentityTable"),
    "recruitment": ("hcm-recruitment", "RecruitmentTable"),
    "time_leave": ("hcm-time-leave", "TimeLeaveTable"),
    "notifications": ("hcm-notifications", "NotificationsTable"),
}


def to_json(rows: list) -> str:
    """Filas -> JSON para jsonb_to_recordset (fechas ISO, Decimal como texto)."""
    def default(value):
        if isinstance(value, (date,)):
            return value.isoformat()
        if isinstance(value, Decimal):
            return str(value)
        raise TypeError(f"No serializable: {type(value)}")
    return json.dumps(rows, default=default, ensure_ascii=False)


def load_identity_passwords():
    """identity/src/passwords.py sin importar el paquete src (cada servicio tiene el suyo)."""
    path = ROOT / "services" / "identity" / "src" / "passwords.py"
    spec = importlib.util.spec_from_file_location("identity_passwords", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@dataclass
class Context:
    stage: str = "dev"
    region: str = "us-east-1"
    tables: dict = field(default_factory=dict)        # servicio -> nombre de tabla
    payslip_bucket: str | None = None
    employees_db: str = "hcm_employees"
    payroll_db: str = "hcm_payroll"
    user_password: str | None = None
    _password_hash: str | None = None
    _dynamodb: object = None

    @classmethod
    def from_aws(cls, services: list) -> "Context":
        bootstrap.load_env(ROOT / ".env")
        ctx = cls(
            stage=os.environ.get("STAGE", "dev"),
            region=os.environ.get("AWS_REGION", "us-east-1"),
            employees_db=os.environ.get("DB_EMPLOYEES_NAME", "hcm_employees"),
            payroll_db=os.environ.get("DB_PAYROLL_NAME", "hcm_payroll"),
            user_password=os.environ.get("SEED_USER_PASSWORD") or os.environ.get("SEED_ADMIN_PASSWORD"),
        )
        cf = boto3.client("cloudformation", region_name=ctx.region)

        def physical_id(stack: str, logical: str) -> str:
            try:
                return cf.describe_stack_resource(StackName=stack, LogicalResourceId=logical)[
                    "StackResourceDetail"]["PhysicalResourceId"]
            except Exception as exc:
                sys.exit(f"No se encontró {logical} en el stack {stack}. ¿Ya lo desplegaste? ({exc})")

        for service in services:
            if service in TABLES:
                stack, logical = TABLES[service]
                ctx.tables[service] = physical_id(f"{stack}-{ctx.stage}", logical)
        if "employees" in services or "payroll" in services:
            infra = bootstrap.stack_outputs(cf, f"hcm-infra-{ctx.stage}")
            os.environ.update({
                "DB_HOST": infra["DbHost"], "DB_PORT": str(infra.get("DbPort", 5432)),
                "DB_USER": bootstrap.require("DB_USER"), "DB_PASSWORD": bootstrap.require("DB_PASSWORD"),
            })
        if "payroll" in services:
            ctx.payslip_bucket = physical_id(f"hcm-payroll-{ctx.stage}", "PayslipBucket")
            os.environ["BUCKET_NAME"] = ctx.payslip_bucket
        return ctx

    def table(self, service: str):
        if self._dynamodb is None:
            self._dynamodb = boto3.resource("dynamodb", region_name=self.region)
        return self._dynamodb.Table(self.tables[service])

    def password_hash(self) -> str:
        """Un solo hash para todos los usuarios activos: PBKDF2 10 000 veces sería muy lento."""
        if self._password_hash is None:
            if not self.user_password or len(self.user_password) < 8:
                sys.exit("Define SEED_ADMIN_PASSWORD (o SEED_USER_PASSWORD) con 8 caracteres o más")
            self._password_hash = load_identity_passwords().hash_password(self.user_password)
        return self._password_hash


def write_items(table, items) -> int:
    """Escribe en lotes de 25 con batch_writer (reintenta solos los UnprocessedItems)."""
    count = 0
    with table.batch_writer(overwrite_by_pkeys=["PK", "SK"]) as batch:
        for item in items:
            batch.put_item(Item=item)
            count += 1
    return count
