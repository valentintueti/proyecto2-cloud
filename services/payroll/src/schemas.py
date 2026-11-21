"""Validation shared by the payroll run API and event consumer."""

import re
from datetime import date, datetime, timedelta, timezone


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
