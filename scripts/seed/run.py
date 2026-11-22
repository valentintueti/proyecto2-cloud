"""Carga datos de prueba escribiendo DIRECTO en DynamoDB y RDS (nunca por la API).

Uso, desde la raíz del repo y con el venv de scripts/requirements.txt:
    .venv/bin/python scripts/seed/run.py
    .venv/bin/python scripts/seed/run.py --tenants acme --per-tenant 10000 --services identity,employees

No invoca Lambdas ni publica eventos. Se puede volver a ejecutar: los ids son determinísticos.
"""
import argparse
import importlib
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from context import Context, ROOT, bootstrap  # noqa: E402
from people import company  # noqa: E402

# employees antes que payroll: payroll usa la misma lista y debe existir el schema de employees.
SERVICES = ["employees", "payroll", "identity", "recruitment", "time_leave", "notifications"]


def parse_args():
    bootstrap.load_env(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Seeds de datos de prueba por tenant.")
    parser.add_argument("--tenants", default=os.environ.get("TENANTS", "acme,globex,initech"),
                        help="Tenants separados por coma (por defecto TENANTS del .env)")
    parser.add_argument("--per-tenant", type=int, default=int(os.environ.get("SEED_RECORDS_PER_TENANT", 10000)),
                        help="Empleados por tenant; cada servicio genera al menos esa cantidad de registros")
    parser.add_argument("--services", default="all", help=f"'all' o una lista: {','.join(SERVICES)}")
    args = parser.parse_args()
    args.tenants = [t.strip() for t in args.tenants.split(",") if t.strip()]
    args.services = SERVICES if args.services == "all" else [s.strip() for s in args.services.split(",")]
    unknown = set(args.services) - set(SERVICES)
    if unknown:
        parser.error(f"Servicios desconocidos: {', '.join(sorted(unknown))}")
    args.services = [s for s in SERVICES if s in args.services]
    return args


def main():
    args = parse_args()
    ctx = Context.from_aws(args.services)
    modules = {s: importlib.import_module(f"seed_{s}") for s in args.services}
    started = time.time()
    for tenant in args.tenants:
        print(f"\n== {tenant} ({args.per_tenant} empleados)")
        data = company(tenant, args.per_tenant)
        for service in args.services:
            t0 = time.time()
            count = modules[service].seed(ctx, data)
            print(f"  {service:<14} {count:>7} registros  ({time.time() - t0:.1f} s)")
    print(f"\nListo en {time.time() - started:.0f} s. Verifica con: .venv/bin/python scripts/seed/verify.py")
    print(f"Usuarios de prueba: empleado1@<tenant>.com ... empleado{args.per_tenant}@<tenant>.com "
          f"(jefes: empleado1..10), con la contraseña SEED_ADMIN_PASSWORD.")


if __name__ == "__main__":
    main()
