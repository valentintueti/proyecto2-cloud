"""Validation shared by the payroll run API and event consumer."""

import re
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from common.http import get_limit, query_param


LIMA_TIME = timezone(timedelta(hours=-5))


def parse_period(value: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", value):
        raise ValueError("period debe tener formato YYYY-MM")
    try:
        return date.fromisoformat(f"{value}-01")
    except ValueError as exc:
        raise ValueError("period debe tener formato YYYY-MM y un año válido") from exc


def validate_requested_period(value: str) -> None:
    if parse_period(value) > datetime.now(LIMA_TIME).date().replace(day=1):
        raise ValueError("period no puede ser un mes futuro")


def parse_id(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError(f"{field} no es un UUID válido") from exc


def pagination(event: dict) -> tuple[int, int]:
    limit = get_limit(event)
    try:
        offset = int(query_param(event, "offset", "0"))
    except (ValueError, TypeError) as exc:
        raise ValueError("offset debe ser un entero") from exc
    if offset < 0 or offset > 2**63 - 1:
        raise ValueError("offset fuera de rango")
    return limit, offset


def search_term(event: dict) -> str:
    term = (query_param(event, "q") or "").strip()
    if len(term) > 100:
        raise ValueError("q admite hasta 100 caracteres")
    return term


def to_api(row: dict, id_key: str) -> dict:
    result = {}
    for key, value in row.items():
        first, *rest = key.split("_")
        name = id_key if key == "id" else first + "".join(part.title() for part in rest)
        result[name] = str(value) if isinstance(value, UUID) else value
    return result
