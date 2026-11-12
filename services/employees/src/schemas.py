"""Entrada y salida de la API de employees: validación, mapeo a columnas y datos de eventos.
No toca la base de datos."""
import re
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

ADMIN, MANAGER, EMPLOYEE = "ADMIN_RRHH", "MANAGER", "EMPLOYEE"
ALL_ROLES = (ADMIN, MANAGER, EMPLOYEE)
STATUSES = ("ACTIVE", "TERMINATED")
MAX_MONEY = Decimal("99999999.99")  # NUMERIC(10,2)
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

# Campo de la API -> columna de employees. Es la lista blanca de lo que se puede escribir.
EMPLOYEE_FIELDS = {
    "firstName": "first_name",
    "lastName": "last_name",
    "email": "email",
    "documentNumber": "document_number",
    "phone": "phone",
    "hireDate": "hire_date",
    "salary": "salary",
    "departmentId": "department_id",
    "positionId": "position_id",
    "managerId": "manager_id",
}
REQUIRED_ON_CREATE = ("firstName", "lastName", "email", "documentNumber", "hireDate", "salary")
NULLABLE_FIELDS = {"phone", "departmentId", "positionId", "managerId"}
NOT_UPDATABLE = {"email", "status", "terminationDate"}


# ── Parsers básicos ──────────────────────────────────────────────────────────

def parse_uuid(value, field="id") -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise ValueError(f"{field} no es un UUID válido")


def parse_date(value, field) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValueError(f"{field} debe tener formato YYYY-MM-DD")


def parse_money(value, field) -> Decimal:
    if isinstance(value, bool):
        raise ValueError(f"{field} debe ser un número")
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        raise ValueError(f"{field} debe ser un número")
    if not amount.is_finite() or amount < 0 or amount > MAX_MONEY:
        raise ValueError(f"{field} debe estar entre 0 y {MAX_MONEY}")
    return amount.quantize(Decimal("0.01"))


def clean_text(value, field, max_length, *, required=True):
    text = "" if value is None else str(value).strip()
    if not text:
        if required:
            raise ValueError(f"{field} es obligatorio")
        return None
    if len(text) > max_length:
        raise ValueError(f"{field} admite máximo {max_length} caracteres")
    return text


def normalize_email(value) -> str:
    email = clean_text(value, "email", 254).lower()
    if not _EMAIL.fullmatch(email):
        raise ValueError("email inválido")
    return email


_PARSERS = {
    "firstName": lambda v: clean_text(v, "firstName", 80),
    "lastName": lambda v: clean_text(v, "lastName", 80),
    "email": normalize_email,
    "documentNumber": lambda v: clean_text(v, "documentNumber", 20),
    "phone": lambda v: clean_text(v, "phone", 30, required=False),
    "hireDate": lambda v: parse_date(v, "hireDate"),
    "salary": lambda v: parse_money(v, "salary"),
    "departmentId": lambda v: parse_uuid(v, "departmentId"),
    "positionId": lambda v: parse_uuid(v, "positionId"),
    "managerId": lambda v: parse_uuid(v, "managerId"),
}


def _parse_field(field, value):
    if value is None and field in NULLABLE_FIELDS:
        return None
    return _PARSERS[field](value)


def _reject_unknown(body, allowed):
    unknown = set(body) - set(allowed)
    if unknown:
        raise ValueError(f"Campos no permitidos: {', '.join(sorted(unknown))}")


# ── Empleados ────────────────────────────────────────────────────────────────

def new_employee(body: dict) -> dict:
    """Body de la API -> columnas para INSERT."""
    _reject_unknown(body, EMPLOYEE_FIELDS)
    missing = [f for f in REQUIRED_ON_CREATE if body.get(f) in (None, "")]
    if missing:
        raise ValueError(f"Faltan campos: {', '.join(missing)}")
    return {EMPLOYEE_FIELDS[f]: _parse_field(f, v) for f, v in body.items()}


def employee_changes(body: dict) -> dict:
    """Body de PATCH -> columnas para UPDATE."""
    blocked = set(body) & NOT_UPDATABLE
    if blocked:
        raise ValueError(
            f"No se puede modificar: {', '.join(sorted(blocked))}. Para dar de baja usa /terminate"
        )
    _reject_unknown(body, EMPLOYEE_FIELDS)
    if not body:
        raise ValueError("No hay campos para actualizar")
    return {EMPLOYEE_FIELDS[f]: _parse_field(f, v) for f, v in body.items()}


def list_filters(params: dict | None) -> dict:
    params = params or {}
    filters = {}
    if params.get("departmentId"):
        filters["department_id"] = parse_uuid(params["departmentId"], "departmentId")
    if params.get("status"):
        status = str(params["status"]).upper()
        if status not in STATUSES:
            raise ValueError(f"status debe ser uno de {list(STATUSES)}")
        filters["status"] = status
    q = str(params.get("q") or "").strip()
    if len(q) > 100:
        raise ValueError("q admite máximo 100 caracteres")
    if q:
        filters["q"] = q
    return filters


def parse_offset(params: dict | None) -> int:
    raw = (params or {}).get("offset")
    if raw is None:
        return 0
    try:
        offset = int(raw)
    except ValueError:
        raise ValueError("offset debe ser un entero")
    if offset < 0:
        raise ValueError("offset debe ser mayor o igual a 0")
    return offset


def provisional_document(application_id) -> str:
    """Documento temporal para empleados que vienen de reclutamiento (máx. 20 caracteres)."""
    compact = re.sub(r"[^A-Za-z0-9]", "", str(application_id or ""))[:15]
    if not compact:
        raise ValueError("applicationId inválido")
    return f"PEND-{compact}"


# ── Departamentos y puestos ──────────────────────────────────────────────────

def new_department(body: dict) -> dict:
    _reject_unknown(body, {"name"})
    return {"name": clean_text(body.get("name"), "name", 100)}


def new_position(body: dict) -> dict:
    _reject_unknown(body, {"title", "departmentId", "minSalary", "maxSalary"})
    position = {
        "title": clean_text(body.get("title"), "title", 100),
        "department_id": parse_uuid(body.get("departmentId"), "departmentId"),
        "min_salary": None,
        "max_salary": None,
    }
    if body.get("minSalary") is not None:
        position["min_salary"] = parse_money(body["minSalary"], "minSalary")
    if body.get("maxSalary") is not None:
        position["max_salary"] = parse_money(body["maxSalary"], "maxSalary")
    if position["min_salary"] is not None and position["max_salary"] is not None \
            and position["min_salary"] > position["max_salary"]:
        raise ValueError("minSalary no puede ser mayor que maxSalary")
    return position


# ── Salida ───────────────────────────────────────────────────────────────────

def _camel(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(part.title() for part in rest)


def to_api(row: dict) -> dict:
    """Fila de la BD -> JSON de la API (camelCase, UUID como texto)."""
    return {_camel(k): (str(v) if isinstance(v, uuid.UUID) else v) for k, v in row.items()}


def employee_created_data(emp: dict, manager_email: str | None = None) -> dict:
    data = {
        "employeeId": str(emp["id"]),
        "email": emp["email"],
        "fullName": f"{emp['first_name']} {emp['last_name']}",
        "hireDate": emp["hire_date"].isoformat(),
    }
    if emp.get("department_id"):
        data["departmentId"] = str(emp["department_id"])
    if manager_email:
        data["managerEmail"] = manager_email
    return data


def employee_terminated_data(emp: dict) -> dict:
    return {
        "employeeId": str(emp["id"]),
        "email": emp["email"],
        "terminationDate": emp["termination_date"].isoformat(),
    }