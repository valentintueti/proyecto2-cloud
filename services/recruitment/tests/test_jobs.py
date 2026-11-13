import json

import pytest

from src.handlers import jobs


def body(resp):
    return json.loads(resp["body"])


def test_create_job_valores_por_defecto(api_event):
    resp = jobs.create_job(api_event(body={"title": "  QA Analyst  "}), None)
    assert resp["statusCode"] == 201
    job = body(resp)
    assert job["title"] == "QA Analyst"
    assert job["status"] == "OPEN"
    assert job["openings"] == 1
    assert job["createdBy"] == "admin@acme.com"
    assert job["createdAt"] == job["updatedAt"]
    assert "PK" not in job and "SK" not in job and "departmentId" not in job


def test_create_job_con_departamento(api_event):
    dep = "3f6c0e0a-1111-4222-8333-444455556666"
    resp = jobs.create_job(api_event(body={"title": "Dev", "departmentId": dep}), None)
    assert body(resp)["departmentId"] == dep


@pytest.mark.parametrize("payload", [
    {},
    {"title": ""},
    {"title": "Dev", "openings": 0},
    {"title": "Dev", "openings": "2"},
    {"title": "Dev", "openings": True},
    {"title": "Dev", "status": "PAUSED"},
    {"title": "Dev", "departmentId": "no-es-uuid"},
    {"title": 123},
])
def test_create_job_valida_datos(api_event, payload):
    assert jobs.create_job(api_event(body=payload), None)["statusCode"] == 400


@pytest.mark.parametrize("role", ["MANAGER", "EMPLOYEE"])
def test_solo_admin_crea_y_edita(api_event, make_job, role):
    assert jobs.create_job(api_event(role=role, body={"title": "Dev"}), None)["statusCode"] == 403
    job_id = make_job()["jobId"]
    resp = jobs.update_job(api_event(role=role, body={"title": "X"}, path={"jobId": job_id}), None)
    assert resp["statusCode"] == 403


def test_get_job_todos_los_roles(api_event, make_job):
    job_id = make_job()["jobId"]
    for role in ("ADMIN_RRHH", "MANAGER", "EMPLOYEE"):
        resp = jobs.get_job(api_event(role=role, path={"jobId": job_id}), None)
        assert resp["statusCode"] == 200
        assert body(resp)["jobId"] == job_id
    assert jobs.get_job(api_event(path={"jobId": "no-existe"}), None)["statusCode"] == 404


def test_update_job(api_event, make_job):
    job = make_job()
    resp = jobs.update_job(api_event(
        body={"title": "Senior Dev", "openings": 5, "status": "CLOSED", "createdBy": "hacker"},
        path={"jobId": job["jobId"]},
    ), None)
    assert resp["statusCode"] == 200
    updated = body(resp)
    assert updated["title"] == "Senior Dev"
    assert updated["openings"] == 5
    assert updated["status"] == "CLOSED"
    assert updated["createdBy"] == "admin@acme.com"
    assert updated["updatedAt"] >= job["updatedAt"]


def test_update_job_errores(api_event, make_job):
    job_id = make_job()["jobId"]
    assert jobs.update_job(api_event(body={}, path={"jobId": job_id}), None)["statusCode"] == 400
    assert jobs.update_job(api_event(body={"openings": -1}, path={"jobId": job_id}), None)["statusCode"] == 400
    assert jobs.update_job(api_event(body={"title": "X"}, path={"jobId": "nope"}), None)["statusCode"] == 404


def test_list_jobs_filtra_por_estado_y_pagina(api_event, make_job):
    make_job(title="A")
    make_job(title="B")
    make_job(title="C", status="CLOSED")

    resp = jobs.list_jobs(api_event(role="EMPLOYEE"), None)
    assert resp["statusCode"] == 200
    assert len(body(resp)["items"]) == 3
    assert body(resp)["nextCursor"] is None

    open_jobs = body(jobs.list_jobs(api_event(query={"status": "OPEN"}), None))["items"]
    assert sorted(j["title"] for j in open_jobs) == ["A", "B"]
    closed = body(jobs.list_jobs(api_event(query={"status": "CLOSED"}), None))["items"]
    assert [j["title"] for j in closed] == ["C"]

    first = body(jobs.list_jobs(api_event(query={"limit": "2"}), None))
    assert len(first["items"]) == 2 and first["nextCursor"]
    second = body(jobs.list_jobs(api_event(query={"limit": "2", "cursor": first["nextCursor"]}), None))
    assert len(second["items"]) == 1

    assert jobs.list_jobs(api_event(query={"status": "OTRO"}), None)["statusCode"] == 400


def test_aislamiento_entre_tenants(api_event, make_job):
    job = make_job("acme")
    make_job("globex", title="Globex job")

    globex = body(jobs.list_jobs(api_event(tenant_id="globex", user_id="admin@globex.com"), None))
    assert [j["title"] for j in globex["items"]] == ["Globex job"]

    other = api_event(tenant_id="globex", user_id="admin@globex.com", path={"jobId": job["jobId"]})
    assert jobs.get_job(other, None)["statusCode"] == 404
    other["body"] = json.dumps({"title": "Hackeado"})
    assert jobs.update_job(other, None)["statusCode"] == 404

    # Un cursor de acme no sirve para leer desde globex.
    make_job("acme", title="Otro")
    cursor = body(jobs.list_jobs(api_event(query={"limit": "1"}), None))["nextCursor"]
    resp = jobs.list_jobs(api_event(tenant_id="globex", query={"cursor": cursor}), None)
    assert resp["statusCode"] == 400


def test_sin_tenant_en_el_authorizer_es_403(api_event):
    event = api_event()
    event["requestContext"] = {}
    assert jobs.list_jobs(event, None)["statusCode"] == 403
