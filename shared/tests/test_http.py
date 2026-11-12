import json
from datetime import date
from decimal import Decimal

import pytest
from conftest import api_event

from common.tenant import get_tenant
from common.http import (
    ConflictError, get_limit, handle_errors, path_param, query_param, require_fields, ok, parse_body
)


def test_ok_serializa_decimal_y_fechas_con_cors():
    res = ok({"salary": Decimal("2500.50"), "days": Decimal("30"), "start": date(2026, 11, 9)})
    assert res["statusCode"] == 200
    assert res["headers"]["Access-Control-Allow-Origin"] == "*"
    assert json.loads(res["body"]) == {"salary": 2500.5, "days": 30, "start": "2026-11-09"}


def test_parse_body():
    assert parse_body({"body": '{"name": "Ana"}'}) == {"name": "Ana"}
    assert parse_body({"body": None}) == {}
    with pytest.raises(ValueError):
        parse_body({"body": "{no json"})
    with pytest.raises(ValueError):
        parse_body({"body": "[1, 2]"})


@handle_errors
def sample_handler(event, context):
    if event.get("boom"):
        raise RuntimeError("algo falló")
    body = parse_body(event)
    return ok({"tenant": get_tenant(event), "name": body["name"]})


def test_handle_errors_mapea_status():
    assert sample_handler(api_event(body='{"name": "Ana"}'), None)["statusCode"] == 200
    assert sample_handler(api_event(body="{mal"), None)["statusCode"] == 400
    assert sample_handler({"requestContext": {}}, None)["statusCode"] == 403
    assert sample_handler({**api_event(), "boom": True}, None)["statusCode"] == 500

def test_path_and_query_params():
    event = {"pathParameters": {"id": "e1"}, "queryStringParameters": {"q": "ana"}}
    assert path_param(event, "id") == "e1"
    assert query_param(event, "q") == "ana"
    assert query_param({}, "q", "x") == "x"
    with pytest.raises(ValueError):
        path_param({}, "id")


@pytest.mark.parametrize("raw,expected", [(None, 20), ("5", 5)])
def test_get_limit_ok(raw, expected):
    event = {"queryStringParameters": {"limit": raw} if raw else None}
    assert get_limit(event) == expected


@pytest.mark.parametrize("raw", ["0", "101", "abc"])
def test_get_limit_invalid(raw):
    with pytest.raises(ValueError):
        get_limit({"queryStringParameters": {"limit": raw}})


def test_require_fields():
    with pytest.raises(ValueError, match="email"):
        require_fields({"name": "Ana", "email": ""}, "name", "email")


def test_conflict_returns_409():
    @handle_errors
    def h(event, context):
        raise ConflictError("Ya existe")

    assert h({}, None)["statusCode"] == 409