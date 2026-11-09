import json
from datetime import date
from decimal import Decimal

import pytest
from conftest import api_event

from common.http import handle_errors, ok, parse_body
from common.tenant import get_tenant


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