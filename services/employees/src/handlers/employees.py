"""API de empleados."""
from common import db_pg, events
from common.http import (
    ConflictError, created, get_limit, handle_errors, not_found, ok,
    parse_body, path_param, require_fields,
)
from common.tenant import require_role
from src import repository as repo
from src import schemas as s


def _manager_email(conn, emp):
    if not emp.get("manager_id"):
        return None
    manager = repo.get_employee(conn, str(emp["manager_id"]))
    return manager["email"] if manager else None


def _can_view(ctx, emp, me) -> bool:
    if ctx["role"] == s.ADMIN or emp["email"] == ctx["userId"]:
        return True
    return ctx["role"] == s.MANAGER and me is not None and emp.get("manager_id") == me["id"]


@handle_errors
def list_employees(event, context):
    ctx = require_role(event, s.ADMIN, s.MANAGER)
    params = event.get("queryStringParameters") or {}
    filters = s.list_filters(params)
    limit, offset = get_limit(event), s.parse_offset(params)

    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        if ctx["role"] == s.MANAGER:
            me = repo.get_employee_by_email(conn, ctx["userId"])
            if me is None:
                return ok({"items": [], "total": 0, "limit": limit, "offset": offset})
            filters["manager_id"] = str(me["id"])
        items, total = repo.list_employees(conn, limit=limit, offset=offset, **filters)

    return ok({"items": [s.to_api(r) for r in items], "total": total,
               "limit": limit, "offset": offset})


@handle_errors
def get_employee(event, context):
    ctx = require_role(event, *s.ALL_ROLES)
    employee_id = s.parse_uuid(path_param(event, "id"))

    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        emp = repo.get_employee(conn, employee_id)
        if emp is None:
            return not_found("Empleado no encontrado")
        me = repo.get_employee_by_email(conn, ctx["userId"]) if ctx["role"] == s.MANAGER else None

    if not _can_view(ctx, emp, me):
        raise PermissionError("No puedes ver la ficha de este empleado")
    return ok(s.to_api(emp))


@handle_errors
def create_employee(event, context):
    ctx = require_role(event, s.ADMIN)
    data = s.new_employee(parse_body(event))

    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        emp = repo.insert_employee(conn, data)
        manager_email = _manager_email(conn, emp)

    # Después del COMMIT: si la transacción falla, no sale el evento.
    events.publish("EmployeeCreated", ctx["tenantId"], s.employee_created_data(emp, manager_email))
    return created(s.to_api(emp))


@handle_errors
def update_employee(event, context):
    ctx = require_role(event, s.ADMIN)
    employee_id = s.parse_uuid(path_param(event, "id"))
    changes = s.employee_changes(parse_body(event))
    if changes.get("manager_id") == employee_id:
        raise ValueError("Un empleado no puede ser su propio jefe")

    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        current = repo.get_employee(conn, employee_id)
        if current is None:
            return not_found("Empleado no encontrado")
        if current["status"] == "TERMINATED":
            raise ConflictError("El empleado está dado de baja")
        emp = repo.update_employee(conn, employee_id, changes)

    return ok(s.to_api(emp))


@handle_errors
def terminate_employee(event, context):
    ctx = require_role(event, s.ADMIN)
    employee_id = s.parse_uuid(path_param(event, "id"))
    body = require_fields(parse_body(event), "terminationDate")
    termination_date = s.parse_date(body["terminationDate"], "terminationDate")

    with db_pg.with_tenant(ctx["tenantId"]) as conn:
        current = repo.get_employee(conn, employee_id)
        if current is None:
            return not_found("Empleado no encontrado")
        if current["status"] == "TERMINATED":
            raise ConflictError("El empleado ya está dado de baja")
        if current["email"] == ctx["userId"]:
            raise ValueError("No puedes darte de baja a ti mismo")
        if termination_date < current["hire_date"]:
            raise ValueError("terminationDate no puede ser anterior a hireDate")
        emp = repo.terminate_employee(conn, employee_id, termination_date)
        if emp is None:  # otra request lo terminó entre medio
            raise ConflictError("El empleado ya está dado de baja")

    events.publish("EmployeeTerminated", ctx["tenantId"], s.employee_terminated_data(emp))
    return ok(s.to_api(emp))