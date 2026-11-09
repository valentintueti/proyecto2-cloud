import base64
import functools
import json
import logging
from datetime import date, datetime
from decimal import Decimal

from .auth import AuthError
from .tenant import TenantError

logger = logging.getLogger(__name__)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
}


def _json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Tipo no serializable a JSON: {type(value).__name__}")


def response(status: int, body=None) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **CORS_HEADERS},
        "body": "" if body is None else json.dumps(body, default=_json_default, ensure_ascii=False),
    }


def ok(body=None):
    return response(200, body)


def created(body=None):
    return response(201, body)


def no_content():
    return response(204)


def _error(status: int, message: str):
    return response(status, {"error": message})


def bad_request(message="Solicitud inválida"):
    return _error(400, message)


def unauthorized(message="No autenticado"):
    return _error(401, message)


def forbidden(message="Acceso denegado"):
    return _error(403, message)


def not_found(message="No encontrado"):
    return _error(404, message)


def conflict(message="Conflicto"):
    return _error(409, message)


def server_error(message="Error interno"):
    return _error(500, message)


def parse_body(event: dict) -> dict:
    raw = event.get("body")
    if not raw:
        return {}
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("El body no es JSON válido") from exc
    if not isinstance(data, dict):
        raise ValueError("El body debe ser un objeto JSON")
    return data


def handle_errors(func):

    @functools.wraps(func)
    def wrapper(event, context):
        try:
            return func(event, context)
        except AuthError as exc:
            return unauthorized(str(exc))
        except (TenantError, PermissionError) as exc:
            return forbidden(str(exc))
        except ValueError as exc:
            return bad_request(str(exc))
        except Exception:
            logger.exception("Error no controlado")
            return server_error()

    return wrapper