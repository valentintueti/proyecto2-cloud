"""Cuenta los registros de cada microservicio por tenant y marca los que no llegan al mínimo.

Uso: .venv/bin/python scripts/seed/verify.py [--min 10000]
"""
import argparse
import os
import sys
from pathlib import Path

from boto3.dynamodb.conditions import Key

sys.path.insert(0, str(Path(__file__).resolve().parent))

from context import TABLES, Context, ROOT, bootstrap  # noqa: E402
from common import db_pg  # noqa: E402

RDS_COUNTS = {
    "employees": ("employees_db", "SELECT (SELECT count(*) FROM employees) + (SELECT count(*) FROM departments)"
                                  " + (SELECT count(*) FROM positions)"),
    "payroll": ("payroll_db", "SELECT (SELECT count(*) FROM payroll_employees) + (SELECT count(*) FROM payslips)"
                              " + (SELECT count(*) FROM leave_records) + (SELECT count(*) FROM payroll_runs)"),
}


def dynamo_count(table, tenant: str) -> int:
    total, kwargs = 0, {"KeyConditionExpression": Key("PK").eq(f"TENANT#{tenant}"), "Select": "COUNT"}
    while True:
        resp = table.query(**kwargs)
        total += resp["Count"]
        if "LastEvaluatedKey" not in resp:
            return total
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def rds_count(ctx, tenant: str, service: str) -> int:
    db_attr, sql = RDS_COUNTS[service]
    try:
        with db_pg.with_tenant(tenant, db_name=getattr(ctx, db_attr)) as conn:
            return conn.run(sql)[0][0]
    except Exception:
        return 0     # el schema todavía no existe


def main():
    bootstrap.load_env(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("--min", type=int, default=int(os.environ.get("SEED_RECORDS_PER_TENANT", 10000)))
    parser.add_argument("--tenants", default=os.environ.get("TENANTS", "acme,globex,initech"))
    args = parser.parse_args()
    tenants = [t.strip() for t in args.tenants.split(",") if t.strip()]
    services = ["employees", "payroll", *TABLES]
    ctx = Context.from_aws(services)

    print(f"{'servicio':<14}" + "".join(f"{t:>12}" for t in tenants) + f"{'total':>12}")
    ok = True
    for service in services:
        counts = [rds_count(ctx, t, service) if service in RDS_COUNTS else dynamo_count(ctx.table(service), t)
                  for t in tenants]
        flags = ["" if c >= args.min else " *" for c in counts]
        ok &= all(not f for f in flags)
        print(f"{service:<14}" + "".join(f"{c:>10}{f:<2}" for c, f in zip(counts, flags)) + f"{sum(counts):>12}")
    print("\nTodo cumple el mínimo." if ok else f"\n* menos de {args.min} registros en ese tenant.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
