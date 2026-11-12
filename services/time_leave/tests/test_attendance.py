import json

from src.handlers import attendance


def body(resp):
    return json.loads(resp["body"])


def test_check_in_uno_por_dia(api_event, at_lima):
    at_lima("2026-11-12T08:58:00")
    first = attendance.check_in(api_event(), None)
    assert first["statusCode"] == 201
    assert body(first)["checkIn"] == "2026-11-12T08:58:00-05:00"
    assert body(first)["date"] == "2026-11-12"

    at_lima("2026-11-12T09:30:00")
    assert attendance.check_in(api_event(), None)["statusCode"] == 409


def test_check_out_requiere_entrada_y_calcula_minutos(api_event, at_lima):
    at_lima("2026-11-12T18:00:00")
    assert attendance.check_out(api_event(), None)["statusCode"] == 400

    at_lima("2026-11-12T08:58:00")
    attendance.check_in(api_event(), None)
    at_lima("2026-11-12T18:03:00")
    resp = attendance.check_out(api_event(), None)
    assert resp["statusCode"] == 200
    assert body(resp)["checkOut"] == "2026-11-12T18:03:00-05:00"
    assert body(resp)["workedMinutes"] == 545

    assert attendance.check_out(api_event(), None)["statusCode"] == 409


def test_my_attendance_filtra_por_rango(api_event, at_lima):
    for day in ("2026-11-10", "2026-11-11", "2026-11-12"):
        at_lima(f"{day}T09:00:00")
        attendance.check_in(api_event(), None)

    resp = attendance.my_attendance(api_event(query={"from": "2026-11-11", "to": "2026-11-12"}), None)
    assert resp["statusCode"] == 200
    assert [i["date"] for i in body(resp)["items"]] == ["2026-11-11", "2026-11-12"]

    bad = attendance.my_attendance(api_event(query={"from": "2026-11-12", "to": "2026-11-01"}), None)
    assert bad["statusCode"] == 400


def test_list_attendance_roles_y_tenants(api_event, at_lima):
    at_lima("2026-11-12T09:00:00")
    attendance.check_in(api_event(), None)
    query = {"email": "ana@acme.com"}

    assert attendance.list_attendance(api_event(query=query), None)["statusCode"] == 403

    acme = attendance.list_attendance(api_event(role="MANAGER", user_id="jefe@acme.com", query=query), None)
    assert len(body(acme)["items"]) == 1

    globex = attendance.list_attendance(
        api_event(tenant_id="globex", role="MANAGER", user_id="jefe@globex.com", query=query), None,
    )
    assert body(globex)["items"] == []

    no_email = attendance.list_attendance(api_event(role="ADMIN_RRHH", user_id="rrhh@acme.com"), None)
    assert no_email["statusCode"] == 400
