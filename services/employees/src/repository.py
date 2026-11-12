"""SQL de employees.

Todas las funciones reciben una conexión abierta con db_pg.with_tenant(), así que las tablas
se resuelven en el schema del tenant. Los datos SIEMPRE van como parámetros (:nombre).
Los f-strings solo arman fragmentos fijos de este archivo o columnas de la lista blanca."""
from pg8000.exceptions import DatabaseError

from common.db_pg import query
from common.http import ConflictError
from src.schemas import EMPLOYEE_FIELDS

WRITABLE_COLUMNS = frozenset(EMPLOYEE_FIELDS.values())
UNIQUE_VIOLATION = "23505"
FK_VIOLATION = "23503"
UNIQUE_MESSAGES = {
    "employees_email_key": "Ya existe un empleado con ese email",
    "employees_document_number_key": "Ya existe un empleado con ese documento",
    "departments_name_key": "Ya existe un departamento con ese nombre",
    "positions_title_department_id_key": "Ya existe ese puesto en el departamento",
}

EMPLOYEE_SELECT = """
SELECT e.id, e.first_name, e.last_name, e.email, e.document_number, e.phone,
       e.hire_date, e.termination_date, e.status, e.salary,
       e.department_id, d.name AS department_name,
       e.position_id, p.title AS position_title,
       e.manager_id, e.created_at, e.updated_at
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN positions p ON p.id = e.position_id
"""

POSITION_SELECT = """
SELECT p.id, p.title, p.department_id, d.name AS department_name, p.min_salary, p.max_salary
FROM positions p
JOIN departments d ON d.id = p.department_id
"""


# ── Utilidades ───────────────────────────────────────────────────────────────

def _pg_error(exc: DatabaseError) -> dict:
    info = exc.args[0] if exc.args else None
    return info if isinstance(info, dict) else {}


def _run_write(conn, sql, **params):
    """INSERT/UPDATE que traduce errores de integridad a errores de la API."""
    try:
        return query(conn, sql, **params)
    except DatabaseError as exc:
        info = _pg_error(exc)
        if info.get("C") == UNIQUE_VIOLATION:
            raise ConflictError(UNIQUE_MESSAGES.get(info.get("n"), "Registro duplicado")) from exc
        if info.get("C") == FK_VIOLATION:
            raise ValueError("Referencia inexistente (departamento, puesto o jefe)") from exc
        raise


def _check_columns(columns):
    invalid = set(columns) - WRITABLE_COLUMNS
    if invalid:
        raise RuntimeError(f"Columnas no permitidas: {sorted(invalid)}")


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ── Empleados ────────────────────────────────────────────────────────────────

def list_employees(conn, *, limit, offset, department_id=None, status=None, q=None, manager_id=None):
    where, params = [], {}
    if department_id:
        where.append("e.department_id = :department_id")
        params["department_id"] = department_id
    if status:
        where.append("e.status = :status")
        params["status"] = status
    if manager_id:
        where.append("e.manager_id = :manager_id")
        params["manager_id"] = manager_id
    if q:
        where.append("(e.first_name ILIKE :q OR e.last_name ILIKE :q OR e.email ILIKE :q)")
        params["q"] = f"%{_escape_like(q)}%"
    clause = f"WHERE {' AND '.join(where)}" if where else ""

    total = query(conn, f"SELECT count(*) AS total FROM employees e {clause}", **params)[0]["total"]
    items = query(
        conn,
        f"{EMPLOYEE_SELECT} {clause} ORDER BY e.last_name, e.first_name, e.id "
        "LIMIT :limit OFFSET :offset",
        limit=limit, offset=offset, **params,
    )
    return items, total


def get_employee(conn, employee_id):
    rows = query(conn, f"{EMPLOYEE_SELECT} WHERE e.id = :id", id=employee_id)
    return rows[0] if rows else None


def get_employee_by_email(conn, email):
    rows = query(conn, f"{EMPLOYEE_SELECT} WHERE e.email = :email", email=email)
    return rows[0] if rows else None


def insert_employee(conn, data: dict) -> dict:
    _check_columns(data)
    columns = list(data)
    sql = (
        f"INSERT INTO employees ({', '.join(columns)}) "
        f"VALUES ({', '.join(':' + c for c in columns)}) RETURNING id"
    )
    new_id = _run_write(conn, sql, **data)[0]["id"]
    return get_employee(conn, new_id)


def update_employee(conn, employee_id, changes: dict):
    _check_columns(changes)
    sets = ", ".join(f"{c} = :{c}" for c in changes)
    rows = _run_write(
        conn,
        f"UPDATE employees SET {sets}, updated_at = now() WHERE id = :employee_id RETURNING id",
        employee_id=employee_id, **changes,
    )
    return get_employee(conn, employee_id) if rows else None


def terminate_employee(conn, employee_id, termination_date):
    rows = query(
        conn,
        "UPDATE employees SET status = 'TERMINATED', termination_date = :termination_date, "
        "updated_at = now() WHERE id = :id AND status = 'ACTIVE' RETURNING id",
        id=employee_id, termination_date=termination_date,
    )
    return get_employee(conn, employee_id) if rows else None


# ── Departamentos ────────────────────────────────────────────────────────────

def list_departments(conn):
    return query(conn, "SELECT id, name, created_at FROM departments ORDER BY name")


def insert_department(conn, data: dict) -> dict:
    return _run_write(
        conn, "INSERT INTO departments (name) VALUES (:name) RETURNING id, name, created_at", **data
    )[0]


def department_exists(conn, department_id) -> bool:
    return bool(query(conn, "SELECT 1 AS found FROM departments WHERE id = :id", id=department_id))


# ── Puestos ──────────────────────────────────────────────────────────────────

def list_positions(conn, department_id=None):
    if department_id:
        return query(
            conn, f"{POSITION_SELECT} WHERE p.department_id = :department_id ORDER BY p.title",
            department_id=department_id,
        )
    return query(conn, f"{POSITION_SELECT} ORDER BY d.name, p.title")


def insert_position(conn, data: dict) -> dict:
    new_id = _run_write(
        conn,
        "INSERT INTO positions (title, department_id, min_salary, max_salary) "
        "VALUES (:title, :department_id, :min_salary, :max_salary) RETURNING id",
        **data,
    )[0]["id"]
    return query(conn, f"{POSITION_SELECT} WHERE p.id = :id", id=new_id)[0]


def find_position_by_title(conn, title, department_id=None):
    sql = "SELECT id, department_id FROM positions WHERE lower(title) = lower(:title)"
    params = {"title": title}
    if department_id:
        sql += " AND department_id = :department_id"
        params["department_id"] = department_id
    rows = query(conn, sql + " ORDER BY title LIMIT 1", **params)
    return rows[0] if rows else None