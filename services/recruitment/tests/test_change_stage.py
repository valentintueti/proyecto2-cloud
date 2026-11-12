import json

import pytest

from common.db_dynamo import TenantTable
from common.events import parse_record
from src import repository as repo
from src.handlers import applications, jobs

PIPELINE = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED"]


def body(resp):
    return json.loads(resp["body"])


def _path(app):
    return {"jobId": app["jobId"], "applicationId": app["applicationId"]}


def _move(api_event, app, stage, role="MANAGER", **extra):
    return applications.change_stage(
        api_event(role=role, user_id="jefe@acme.com", body={"stage": stage, **extra}, path=_path(app)), None,
    )


def _set_stage(app, stage):
    TenantTable("acme").update(repo.application_sk(app["jobId"], app["applicationId"]), {"stage": stage})


def _job(job_id):
    return TenantTable("acme").get(repo.job_sk(job_id))


def test_avanza_por_todo_el_pipeline(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    for stage in PIPELINE[1:]:
        resp = _move(api_event, app, stage)
        assert resp["statusCode"] == 200, resp["body"]
        assert body(resp)["stage"] == stage


@pytest.mark.parametrize("current", ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"])
def test_rechazar_desde_cualquier_etapa_menos_hired(api_event, make_job, make_application, current):
    app = make_application(make_job()["jobId"])
    _set_stage(app, current)
    resp = _move(api_event, app, "REJECTED", notes="No cumple el perfil")
    assert resp["statusCode"] == 200
    assert body(resp)["stage"] == "REJECTED"
    assert body(resp)["notes"] == "No cumple el perfil"


@pytest.mark.parametrize("current,target", [
    ("APPLIED", "INTERVIEW"),
    ("APPLIED", "OFFER"),
    ("APPLIED", "HIRED"),
    ("APPLIED", "APPLIED"),
    ("SCREENING", "APPLIED"),
    ("SCREENING", "OFFER"),
    ("INTERVIEW", "SCREENING"),
    ("INTERVIEW", "HIRED"),
    ("OFFER", "INTERVIEW"),
    ("HIRED", "REJECTED"),
    ("HIRED", "OFFER"),
    ("REJECTED", "SCREENING"),
    ("REJECTED", "REJECTED"),
    ("APPLIED", "DESCONOCIDA"),
])
def test_transiciones_invalidas_devuelven_400(api_event, make_job, make_application, current, target):
    app = make_application(make_job()["jobId"])
    _set_stage(app, current)
    resp = _move(api_event, app, target)
    assert resp["statusCode"] == 400
    stored = TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"]))
    assert stored["stage"] == current


def test_change_stage_postulacion_inexistente(api_event, make_job):
    job_id = make_job()["jobId"]
    resp = applications.change_stage(
        api_event(body={"stage": "SCREENING"}, path={"jobId": job_id, "applicationId": "nope"}), None)
    assert resp["statusCode"] == 404


def test_hired_publica_candidate_hired_con_el_contrato(api_event, make_job, make_application, published):
    dep = "3f6c0e0a-1111-4222-8333-444455556666"
    job = make_job(title="Backend Developer", departmentId=dep, openings=2)
    app = make_application(job["jobId"])
    _set_stage(app, "OFFER")

    resp = _move(api_event, app, "HIRED", startDate="2026-12-01", salary=4500)
    assert resp["statusCode"] == 200
    assert body(resp)["stage"] == "HIRED"

    messages = published()
    assert len(messages) == 1
    event = parse_record({"messageId": "m-1", "body": messages[0]["Body"]})
    assert set(event) == {"eventId", "eventType", "tenantId", "source", "occurredAt", "data"}
    assert event["eventType"] == "CandidateHired"
    assert event["tenantId"] == "acme"
    assert event["source"] == "recruitment"
    assert event["data"] == {
        "applicationId": app["applicationId"],
        "jobId": job["jobId"],
        "email": "lucia@mail.com",
        "firstName": "Lucía",
        "lastName": "Pérez",
        "positionTitle": "Backend Developer",
        "departmentId": dep,
        "salary": 4500,
        "startDate": "2026-12-01",
    }

    # Resta 1 vacante; quedan 1, sigue OPEN.
    stored = _job(job["jobId"])
    assert stored["openings"] == 1 and stored["status"] == "OPEN"


def test_hired_sin_opcionales(api_event, make_job, make_application, published, monkeypatch):
    from datetime import date
    monkeypatch.setattr(repo, "today_lima", lambda: date(2026, 11, 12))
    job = make_job()  # sin departmentId
    app = make_application(job["jobId"])
    _set_stage(app, "OFFER")
    assert _move(api_event, app, "HIRED")["statusCode"] == 200

    data = parse_record({"messageId": "m", "body": published()[0]["Body"]})["data"]
    assert "departmentId" not in data and "salary" not in data
    assert data["startDate"] == "2026-11-12"


@pytest.mark.parametrize("extra", [{"startDate": "01/12/2026"}, {"startDate": "2026-02-30"},
                                   {"salary": -1}, {"salary": "mucho"}])
def test_hired_valida_start_date_y_salary(api_event, make_job, make_application, published, extra):
    app = make_application(make_job()["jobId"])
    _set_stage(app, "OFFER")
    assert _move(api_event, app, "HIRED", **extra)["statusCode"] == 400
    assert published() == []
    assert TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"]))["stage"] == "OFFER"


def test_ultima_vacante_cierra_el_puesto(api_event, make_job, make_application, published):
    job = make_job(openings=1)
    first = make_application(job["jobId"], email="a@mail.com")
    second = make_application(job["jobId"], email="b@mail.com")
    _set_stage(first, "OFFER")
    _set_stage(second, "OFFER")

    assert _move(api_event, first, "HIRED")["statusCode"] == 200
    stored = _job(job["jobId"])
    assert stored["openings"] == 0 and stored["status"] == "CLOSED"

    # Sin puestos disponibles: no se puede contratar a otro ni se publica el evento.
    assert _move(api_event, second, "HIRED")["statusCode"] == 409
    assert len(published()) == 1
    assert TenantTable("acme").get(repo.application_sk(job["jobId"], second["applicationId"]))["stage"] == "OFFER"

    # La vacante cerrada ya no recibe postulaciones.
    resp = applications.create_application(api_event(
        body={"firstName": "C", "lastName": "D", "email": "c@mail.com"}, path={"jobId": job["jobId"]}), None)
    assert resp["statusCode"] == 400


def test_hired_concurrente_no_deja_openings_negativo(api_event, make_job, make_application):
    job = make_job(openings=1)
    app = make_application(job["jobId"])
    _set_stage(app, "OFFER")
    stale_job = _job(job["jobId"])
    stale_app = TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"]))

    repo.hire("acme", stale_app, stale_job, None)
    from common.http import ConflictError
    with pytest.raises(ConflictError):
        repo.hire("acme", {**stale_app, "applicationId": app["applicationId"]}, stale_job, None)
    assert _job(job["jobId"])["openings"] == 0


def test_cambio_de_etapa_concurrente_es_409(make_job, make_application):
    app = make_application(make_job()["jobId"])
    stored = TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"]))
    repo.change_stage("acme", stored, "SCREENING", None)
    from common.http import ConflictError
    with pytest.raises(ConflictError):
        repo.change_stage("acme", stored, "REJECTED", None)  # leyó APPLIED, ahora es SCREENING


def test_rechazar_no_publica_eventos_ni_toca_la_vacante(api_event, make_job, make_application, published):
    job = make_job(openings=1)
    app = make_application(job["jobId"])
    assert _move(api_event, app, "REJECTED", role="ADMIN_RRHH")["statusCode"] == 200
    assert published() == []
    assert _job(job["jobId"])["openings"] == 1


def test_job_update_no_rompe_postulaciones(api_event, make_job, make_application):
    job = make_job()
    make_application(job["jobId"])
    resp = jobs.update_job(api_event(body={"location": "Arequipa"}, path={"jobId": job["jobId"]}), None)
    assert body(resp)["location"] == "Arequipa"
    listed = applications.list_applications(api_event(path={"jobId": job["jobId"]}), None)
    assert len(body(listed)["items"]) == 1
