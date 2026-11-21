from common.db_dynamo import TenantTable
from src import repository as repo
from src.handlers import on_event

EMPLOYEE = {
    "employeeId": "e-1", "email": "nuevo@acme.com", "fullName": "Nuevo Pérez",
    "hireDate": "2026-12-01", "managerEmail": "jefe@acme.com",
}
LEAVE = {
    "requestId": "r-1", "email": "ana@acme.com", "type": "VACATION",
    "startDate": "2026-12-07", "endDate": "2026-12-11", "days": 5, "approvedBy": "jefe@acme.com",
}
PAYSLIP = {"runId": "run-1", "payslipId": "p-1", "email": "ana@acme.com", "period": "2026-11", "net": 3250.5}


def _inbox(email, tenant_id="acme"):
    items, _ = TenantTable(tenant_id).query(repo.user_prefix(email))
    return items


def _sent(aws):
    return int(aws["ses"].get_send_quota()["SentLast24Hours"])


def test_employee_created_con_jefe_genera_welcome_y_new_team_member(sqs_event):
    assert on_event.handler(sqs_event("EmployeeCreated", EMPLOYEE), None) == {"batchItemFailures": []}

    [welcome] = _inbox("nuevo@acme.com")
    assert welcome["type"] == "WELCOME"
    assert welcome["read"] is False
    assert welcome["createdAt"] == "2026-11-20T15:04:05Z"
    assert welcome["SK"] == f"NOTIF#nuevo@acme.com#2026-11-20T15:04:05Z#{welcome['notificationId']}"

    [team] = _inbox("jefe@acme.com")
    assert team["type"] == "NEW_TEAM_MEMBER"
    assert "Nuevo Pérez" in team["message"]


def test_employee_created_sin_jefe_solo_welcome(sqs_event):
    data = {k: v for k, v in EMPLOYEE.items() if k != "managerEmail"}
    on_event.handler(sqs_event("EmployeeCreated", data), None)
    assert [i["type"] for i in _inbox("nuevo@acme.com")] == ["WELCOME"]
    assert _inbox("jefe@acme.com") == []


def test_leave_approved_y_payslip_generated(sqs_event):
    on_event.handler(sqs_event("LeaveApproved", LEAVE), None)
    on_event.handler(sqs_event("PayslipGenerated", PAYSLIP), None)

    by_type = {i["type"]: i for i in _inbox("ana@acme.com")}
    assert set(by_type) == {"LEAVE_APPROVED", "PAYSLIP_READY"}
    assert by_type["LEAVE_APPROVED"]["link"] == "/leave"
    assert "2026-12-07" in by_type["LEAVE_APPROVED"]["message"]
    assert by_type["PAYSLIP_READY"]["message"] == (
        "Tu boleta de pago de 2026-11 ya está disponible. Neto: S/ 3,250.50."
    )


def test_reprocesar_un_evento_no_duplica(sqs_event):
    leave = sqs_event("LeaveApproved", LEAVE, event_id="evt-leave-1")
    employee = sqs_event("EmployeeCreated", EMPLOYEE, event_id="evt-emp-1")
    for _ in range(3):
        assert on_event.handler(leave, None) == {"batchItemFailures": []}
        assert on_event.handler(employee, None) == {"batchItemFailures": []}

    assert len(_inbox("ana@acme.com")) == 1
    assert len(_inbox("nuevo@acme.com")) == 1
    assert len(_inbox("jefe@acme.com")) == 1
    assert _inbox("ana@acme.com")[0]["sourceEventId"] == "evt-leave-1"


def test_mismo_evento_en_otro_tenant_queda_aislado(sqs_event):
    on_event.handler(sqs_event("LeaveApproved", LEAVE, tenant_id="globex"), None)
    assert _inbox("ana@acme.com") == []
    assert len(_inbox("ana@acme.com", tenant_id="globex")) == 1


def test_eventos_no_soportados_se_ignoran(sqs_event):
    result = on_event.handler(sqs_event("EmployeeTerminated", {"email": "ana@acme.com"}), None)
    assert result == {"batchItemFailures": []}
    assert _inbox("ana@acme.com") == []


def test_con_email_enabled_envia_por_ses_una_sola_vez(sqs_event, aws, monkeypatch):
    monkeypatch.setenv("EMAIL_ENABLED", "true")
    aws["ses"].verify_email_identity(EmailAddress="no-reply@hcm.test")

    event = sqs_event("LeaveApproved", LEAVE, event_id="evt-ses-1")
    on_event.handler(event, None)
    on_event.handler(event, None)  # reprocesado: no se reenvía

    assert _sent(aws) == 1
    assert len(_inbox("ana@acme.com")) == 1


def test_si_ses_rechaza_el_correo_la_notificacion_igual_se_guarda(sqs_event, aws, monkeypatch):
    # Remitente sin verificar: SES (sandbox) responde MessageRejected.
    monkeypatch.setenv("EMAIL_ENABLED", "true")
    result = on_event.handler(sqs_event("LeaveApproved", LEAVE), None)

    assert result == {"batchItemFailures": []}
    assert _sent(aws) == 0
    assert len(_inbox("ana@acme.com")) == 1


def test_si_ses_explota_no_hay_reintentos(sqs_event, monkeypatch):
    class BrokenSes:
        def send_email(self, **kwargs):
            raise RuntimeError("SES caído")

    monkeypatch.setenv("EMAIL_ENABLED", "true")
    monkeypatch.setattr(on_event, "_ses_client", lambda: BrokenSes())

    result = on_event.handler(sqs_event("EmployeeCreated", EMPLOYEE), None)
    assert result == {"batchItemFailures": []}
    assert len(_inbox("nuevo@acme.com")) == 1
    assert len(_inbox("jefe@acme.com")) == 1


def test_con_email_disabled_no_llama_a_ses(sqs_event, monkeypatch):
    def fail():
        raise AssertionError("No debía usar SES")

    monkeypatch.setattr(on_event, "_ses_client", fail)
    assert on_event.handler(sqs_event("LeaveApproved", LEAVE), None) == {"batchItemFailures": []}
