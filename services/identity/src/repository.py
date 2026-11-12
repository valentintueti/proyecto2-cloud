"""Construcción y validación de ítems de identity (tenant y usuario)."""
import re
from datetime import datetime, timezone

from common.auth import ROLES
from src.passwords import hash_password

PROFILE_SK = "PROFILE"
USER_PREFIX = "USER#"
USER_STATUSES = ("ACTIVE", "INVITED", "DISABLED")
UPDATABLE_FIELDS = {"name", "role", "status", "password", "employeeId"}
HIDDEN_FIELDS = {"PK", "SK", "passwordHash"}
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_email(email) -> str:
    email = str(email or "").strip().lower()
    if len(email) > 254 or not _EMAIL.fullmatch(email):
        raise ValueError("email inválido")
    return email


def user_sk(email) -> str:
    return USER_PREFIX + normalize_email(email)


def clean_name(name) -> str:
    name = str(name or "").strip()
    if not 1 <= len(name) <= 120:
        raise ValueError("name debe tener entre 1 y 120 caracteres")
    return name


def validate_role(role) -> str:
    if role not in ROLES:
        raise ValueError(f"role debe ser uno de {sorted(ROLES)}")
    return role


def new_user(email, name, role, *, password=None, employee_id=None) -> dict:
    """Usuario nuevo. Sin contraseña queda INVITED y no puede iniciar sesión."""
    email = normalize_email(email)
    user = {
        "userId": email,
        "email": email,
        "name": clean_name(name),
        "role": validate_role(role),
        "status": "ACTIVE" if password else "INVITED",
        "createdAt": now_iso(),
    }
    if password:
        user["passwordHash"] = hash_password(password)
    if employee_id:
        user["employeeId"] = str(employee_id)
    return user


def build_changes(body: dict) -> dict:
    unknown = set(body) - UPDATABLE_FIELDS
    if unknown:
        raise ValueError(f"Campos no permitidos: {', '.join(sorted(unknown))}")
    changes = {}
    if "name" in body:
        changes["name"] = clean_name(body["name"])
    if "role" in body:
        changes["role"] = validate_role(body["role"])
    if "status" in body:
        if body["status"] not in ("ACTIVE", "DISABLED"):
            raise ValueError("status debe ser ACTIVE o DISABLED")
        changes["status"] = body["status"]
    if "employeeId" in body:
        changes["employeeId"] = str(body["employeeId"])
    if "password" in body:
        changes["passwordHash"] = hash_password(body["password"])
    if not changes:
        raise ValueError("No hay campos para actualizar")
    changes["updatedAt"] = now_iso()
    return changes


def public_user(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in HIDDEN_FIELDS}


def public_tenant(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in ("PK", "SK")}