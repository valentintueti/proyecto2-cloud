import os
import time

import jwt

from .tenant import is_valid_tenant_id

ALGORITHM = "HS256"
ROLES = frozenset({"ADMIN_RRHH", "MANAGER", "EMPLOYEE"})
REQUIRED_CLAIMS = ["sub", "tenantId", "role", "iat", "exp"]
_DEFAULT_EXPIRES = "8h"
_UNITS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


class AuthError(Exception):
    """Token ausente, inválido o expirado."""


def _secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("Falta la variable de entorno JWT_SECRET")
    return secret


def parse_duration(value: str) -> int:
    """'3600' -> 3600, '30m' -> 1800, '8h' -> 28800, '1d' -> 86400."""
    value = value.strip().lower()
    if value.isdigit():
        return int(value)
    number, unit = value[:-1], value[-1:]
    if unit not in _UNITS or not number.isdigit():
        raise ValueError(f"Duración inválida: {value!r} (usa 3600, 30m, 8h o 1d)")
    return int(number) * _UNITS[unit]


def create_token(user_id: str, tenant_id: str, role: str, expires_in: int | None = None) -> str:
    if not is_valid_tenant_id(tenant_id):
        raise ValueError(f"tenantId inválido: {tenant_id!r}")
    if role not in ROLES:
        raise ValueError(f"Rol inválido: {role!r}")
    if expires_in is None:
        expires_in = parse_duration(os.environ.get("JWT_EXPIRES_IN", _DEFAULT_EXPIRES))
    now = int(time.time())
    claims = {
        "sub": str(user_id),
        "tenantId": tenant_id,
        "role": role,
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(claims, _secret(), algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    try:
        claims = jwt.decode(
            token,
            _secret(),
            algorithms=[ALGORITHM],
            options={"require": REQUIRED_CLAIMS},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Token expirado") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Token inválido") from exc

    if not is_valid_tenant_id(claims["tenantId"]):
        raise AuthError("tenantId inválido en el token")
    if claims["role"] not in ROLES:
        raise AuthError("Rol inválido en el token")
    return claims


def extract_bearer(header: str | None) -> str:
    if not header:
        raise AuthError("Falta el header Authorization")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Formato esperado: 'Bearer <token>'")
    return token.strip()