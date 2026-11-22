"""identity: un usuario por empleado en la tabla de identity (no toca admin@<tenant>.com)."""
from context import write_items
from people import DEMO_USERS, rng, utc_iso


def items(company, password_hash: str):
    pk = f"TENANT#{company.tenant}"
    r = rng(company.tenant, "identity")
    for person in company.people:
        if person.termination_date:
            status = "DISABLED"
        elif person.n <= DEMO_USERS or r.random() < 0.8:
            status = "ACTIVE"
        else:
            status = "INVITED"          # invitado: todavía sin contraseña
        user = {
            "PK": pk,
            "SK": f"USER#{person.email}",
            "tenantId": company.tenant,
            "userId": person.email,
            "email": person.email,
            "name": person.full_name,
            "role": person.role,
            "status": status,
            "employeeId": person.id,
            "createdAt": utc_iso(person.hire_date),
        }
        if status != "INVITED":
            user["passwordHash"] = password_hash
        yield user


def seed(ctx, company) -> int:
    return write_items(ctx.table("identity"), items(company, ctx.password_hash()))
