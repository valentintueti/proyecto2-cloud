import json

from common.db_dynamo import TenantTable
from common.events import parse_record
from src import repository as repo
from src.handlers import leave_requests


def body(resp):
    return json.loads(resp["body"])


def _create(api_event, start, end, *, type_="VACATION", user="ana@acme.com", tenant="acme", role="EMPLOYEE"):
    payload = {"type": type_, "startDate": start, "endDate": end, "reason": "viaje"}
    return leave_requests.create_request(
        api_event(tenant_id=tenant, role=role, user_id=user, body=payload), None,
    )


def _decide(action, api_event, request_id, *, user="jefe@acme.com", role="MANAGER", tenant="acme"):
    return action(api_event(tenant_id=tenant, role=role, user_id=user, path={"requestId": request_id}), None)


def _messages(aws):
    resp = aws["sqs"].receive_message(QueueUrl=aws["queue_url"], MaxNumberOfMessages=10)
    return resp.get("Messages", [])


def test_days_cuenta_solo_dias_habiles(api_event):
    # Viernes 13 a lunes 16 de noviembre 2026: incluye sábado y domingo
    resp = _create(api_event, "2026-11-13", "2026-11-16")
    assert resp["statusCode"] == 201
    assert body(resp)["days"] == 2
    assert body(resp)["status"] == "PENDING"
    assert "GSI1PK" not in body(resp)


def test_validaciones_de_fechas_y_tipo(api_event):
    assert _create(api_event, "2026-11-16", "2026-11-13")["statusCode"] == 400
    assert _create(api_event, "13/11/2026", "2026-11-16")["statusCode"] == 400
    assert _create(api_event, "2026-11-14", "2026-11-15")["statusCode"] == 400  # solo fin de semana
    assert _create(api_event, "2026-11-13", "2026-11-16", type_="OTRO")["statusCode"] == 400


def test_vacation_sin_saldo_suficiente_devuelve_409(api_event):
    TenantTable("acme").put(
        repo.balance_sk("ana@acme.com", 2026),
        {"email": "ana@acme.com", "year": 2026, "vacationDays": 3, "usedDays": 0},
    )
    assert _create(api_event, "2026-12-07", "2026-12-11")["statusCode"] == 409  # 5 días
    assert _create(api_event, "2026-12-07", "2026-12-11", type_="SICK")["statusCode"] == 201


def test_my_requests_y_list_requests(api_event):
    _create(api_event, "2026-11-13", "2026-11-16")
    _create(api_event, "2026-11-13", "2026-11-16", user="luis@acme.com")

    mine = leave_requests.my_requests(api_event(), None)
    assert [i["email"] for i in body(mine)["items"]] == ["ana@acme.com"]

    pending = leave_requests.list_requests(
        api_event(role="MANAGER", user_id="jefe@acme.com", query={"status": "PENDING"}), None,
    )
    assert len(body(pending)["items"]) == 2

    assert leave_requests.list_requests(api_event(), None)["statusCode"] == 403
    bad = leave_requests.list_requests(api_event(role="MANAGER", query={"status": "OTRO"}), None)
    assert bad["statusCode"] == 400


def test_manager_de_otro_tenant_no_ve_ni_aprueba(api_event):
    request_id = body(_create(api_event, "2026-11-13", "2026-11-16"))["requestId"]

    globex = leave_requests.list_requests(
        api_event(tenant_id="globex", role="MANAGER", user_id="jefe@globex.com"), None,
    )
    assert body(globex)["items"] == []

    resp = _decide(leave_requests.approve, api_event, request_id, tenant="globex", user="jefe@globex.com")
    assert resp["statusCode"] == 404
    assert TenantTable("acme").get(repo.leave_sk(request_id))["status"] == "PENDING"


def test_nadie_decide_sobre_su_propia_solicitud(api_event):
    request_id = body(_create(api_event, "2026-11-13", "2026-11-16", user="jefe@acme.com", role="MANAGER"))["requestId"]
    assert _decide(leave_requests.approve, api_event, request_id)["statusCode"] == 400
    assert _decide(leave_requests.reject, api_event, request_id)["statusCode"] == 400


def test_dos_aprobaciones_que_exceden_el_saldo(api_event):
    TenantTable("acme").put(
        repo.balance_sk("ana@acme.com", 2026),
        {"email": "ana@acme.com", "year": 2026, "vacationDays": 10, "usedDays": 0},
    )
    first = body(_create(api_event, "2026-12-07", "2026-12-11"))["requestId"]   # 5 días
    second = body(_create(api_event, "2026-12-14", "2026-12-21"))["requestId"]  # 6 días

    assert _decide(leave_requests.approve, api_event, first)["statusCode"] == 200
    assert _decide(leave_requests.approve, api_event, second)["statusCode"] == 409

    table = TenantTable("acme")
    assert table.get(repo.balance_sk("ana@acme.com", 2026))["usedDays"] == 5
    assert table.get(repo.leave_sk(second))["status"] == "PENDING"


def test_solo_se_decide_si_esta_pendiente(api_event, aws):
    request_id = body(_create(api_event, "2026-11-13", "2026-11-16"))["requestId"]
    rejected = _decide(leave_requests.reject, api_event, request_id)
    assert rejected["statusCode"] == 200
    assert body(rejected)["status"] == "REJECTED"
    assert body(rejected)["decidedBy"] == "jefe@acme.com"
    assert _decide(leave_requests.approve, api_event, request_id)["statusCode"] == 409
    assert _messages(aws) == []

    # GSI2PK se actualizó: ya no aparece en PENDING y sí en REJECTED
    manager = {"role": "MANAGER", "user_id": "jefe@acme.com"}
    pending = leave_requests.list_requests(api_event(**manager, query={"status": "PENDING"}), None)
    assert body(pending)["items"] == []
    rejected_list = leave_requests.list_requests(api_event(**manager, query={"status": "REJECTED"}), None)
    assert [i["requestId"] for i in body(rejected_list)["items"]] == [request_id]


def test_cancelar_solo_el_dueno_y_en_pending(api_event):
    request_id = body(_create(api_event, "2026-11-13", "2026-11-16"))["requestId"]

    assert _decide(leave_requests.cancel, api_event, request_id, user="luis@acme.com", role="EMPLOYEE")["statusCode"] == 403
    resp = _decide(leave_requests.cancel, api_event, request_id, user="ana@acme.com", role="EMPLOYEE")
    assert resp["statusCode"] == 200
    assert body(resp)["status"] == "CANCELLED"
    assert _decide(leave_requests.cancel, api_event, request_id, user="ana@acme.com", role="EMPLOYEE")["statusCode"] == 409


def test_leave_approved_sale_con_el_contrato(api_event, aws):
    request_id = body(_create(api_event, "2026-11-13", "2026-11-16"))["requestId"]
    assert _decide(leave_requests.approve, api_event, request_id)["statusCode"] == 200

    messages = _messages(aws)
    assert len(messages) == 1
    event = parse_record({"messageId": "m-1", "body": messages[0]["Body"]})
    assert set(event) == {"eventId", "eventType", "tenantId", "source", "occurredAt", "data"}
    assert event["eventType"] == "LeaveApproved"
    assert event["tenantId"] == "acme"
    assert event["source"] == "time_leave"
    assert event["data"] == {
        "requestId": request_id,
        "email": "ana@acme.com",
        "type": "VACATION",
        "startDate": "2026-11-13",
        "endDate": "2026-11-16",
        "days": 2,
        "approvedBy": "jefe@acme.com",
    }
    balance = TenantTable("acme").get(repo.balance_sk("ana@acme.com", 2026))
    assert balance["usedDays"] == 2
