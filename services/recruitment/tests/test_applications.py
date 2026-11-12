import json
from urllib.parse import urlparse

import pytest

from common.db_dynamo import TenantTable
from src import repository as repo
from src.handlers import applications, jobs


def body(resp):
    return json.loads(resp["body"])


def _path(app):
    return {"jobId": app["jobId"], "applicationId": app["applicationId"]}


def test_create_application(make_job, make_application):
    job = make_job()
    app = make_application(job["jobId"], email="  LUCIA@Mail.com ")
    assert app["email"] == "lucia@mail.com"
    assert app["stage"] == "APPLIED"
    assert app["cvKey"] is None
    assert app["jobId"] == job["jobId"]
    assert "PK" not in app and "tenantId" not in app


def test_create_application_vacante_inexistente_o_cerrada(api_event, make_job):
    payload = {"firstName": "Ana", "lastName": "Ruiz", "email": "ana@mail.com"}
    resp = applications.create_application(api_event(body=payload, path={"jobId": "nope"}), None)
    assert resp["statusCode"] == 404

    closed = make_job(status="CLOSED")
    resp = applications.create_application(api_event(body=payload, path={"jobId": closed["jobId"]}), None)
    assert resp["statusCode"] == 400


def test_mismo_email_dos_veces_en_la_misma_vacante_es_409(api_event, make_job, make_application):
    job, other = make_job(), make_job(title="Otra")
    make_application(job["jobId"])
    payload = {"firstName": "Lucía", "lastName": "Pérez", "email": "Lucia@mail.com"}
    resp = applications.create_application(api_event(body=payload, path={"jobId": job["jobId"]}), None)
    assert resp["statusCode"] == 409
    # En otra vacante sí puede postular.
    make_application(other["jobId"])


@pytest.mark.parametrize("payload", [
    {"lastName": "Ruiz", "email": "a@mail.com"},
    {"firstName": "Ana", "email": "a@mail.com"},
    {"firstName": "Ana", "lastName": "Ruiz", "email": "no-es-email"},
    {"firstName": "Ana", "lastName": "Ruiz", "email": "a@mail.com", "phone": "abc"},
])
def test_create_application_valida_datos(api_event, make_job, payload):
    job_id = make_job()["jobId"]
    resp = applications.create_application(api_event(body=payload, path={"jobId": job_id}), None)
    assert resp["statusCode"] == 400


def test_employee_no_gestiona_postulaciones(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    emp = {"role": "EMPLOYEE", "user_id": "emp@acme.com"}
    assert applications.list_applications(api_event(**emp, path={"jobId": app["jobId"]}), None)["statusCode"] == 403
    resp = applications.create_application(api_event(**emp, body={}, path={"jobId": app["jobId"]}), None)
    assert resp["statusCode"] == 403
    for handler in (applications.cv_upload_url, applications.cv_download_url, applications.change_stage):
        assert handler(api_event(**emp, body={}, path=_path(app)), None)["statusCode"] == 403


def test_list_applications_por_vacante_y_paginado(api_event, make_job, make_application):
    job, other = make_job(), make_job(title="Otra")
    for i in range(3):
        make_application(job["jobId"], email=f"p{i}@mail.com")
    make_application(other["jobId"], email="x@mail.com")

    manager = {"role": "MANAGER", "user_id": "jefe@acme.com"}
    resp = applications.list_applications(api_event(**manager, path={"jobId": job["jobId"]}), None)
    assert resp["statusCode"] == 200
    items = body(resp)["items"]
    assert sorted(i["email"] for i in items) == ["p0@mail.com", "p1@mail.com", "p2@mail.com"]

    page = body(applications.list_applications(
        api_event(**manager, path={"jobId": job["jobId"]}, query={"limit": "2"}), None))
    assert len(page["items"]) == 2 and page["nextCursor"]
    rest = body(applications.list_applications(
        api_event(**manager, path={"jobId": job["jobId"]}, query={"limit": "2", "cursor": page["nextCursor"]}), None))
    assert len(rest["items"]) == 1

    assert applications.list_applications(api_event(path={"jobId": "nope"}), None)["statusCode"] == 404


def test_otro_tenant_no_lista_postulaciones_ni_obtiene_cvs(api_event, make_job, make_application):
    app = make_application(make_job("acme")["jobId"])
    upload = applications.cv_upload_url(api_event(
        body={"fileName": "cv.pdf", "contentType": "application/pdf"}, path=_path(app)), None)
    assert upload["statusCode"] == 200

    globex = {"tenant_id": "globex", "user_id": "admin@globex.com"}
    assert applications.list_applications(api_event(**globex, path={"jobId": app["jobId"]}), None)["statusCode"] == 404
    assert applications.cv_download_url(api_event(**globex, path=_path(app)), None)["statusCode"] == 404
    resp = applications.cv_upload_url(api_event(
        **globex, body={"fileName": "cv.pdf", "contentType": "application/pdf"}, path=_path(app)), None)
    assert resp["statusCode"] == 404
    resp = applications.change_stage(api_event(**globex, body={"stage": "SCREENING"}, path=_path(app)), None)
    assert resp["statusCode"] == 404

    # Aunque globex cree una vacante, nunca ve postulaciones de acme.
    globex_job = make_job("globex")
    resp = applications.list_applications(api_event(**globex, path={"jobId": globex_job["jobId"]}), None)
    assert body(resp)["items"] == []


def test_cv_upload_url_solo_pdf_y_guarda_cv_key(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])

    bad = applications.cv_upload_url(api_event(
        body={"fileName": "cv.docx", "contentType": "application/msword"}, path=_path(app)), None)
    assert bad["statusCode"] == 400
    missing = applications.cv_upload_url(api_event(body={"fileName": "cv.pdf"}, path=_path(app)), None)
    assert missing["statusCode"] == 400

    resp = applications.cv_upload_url(api_event(
        role="MANAGER", body={"fileName": "Mi CV.pdf", "contentType": "application/pdf"}, path=_path(app)), None)
    assert resp["statusCode"] == 200
    data = body(resp)
    expected_key = f"tenants/acme/cvs/{app['applicationId']}/Mi_CV.pdf"
    assert data["cvKey"] == expected_key
    assert urlparse(data["uploadUrl"]).path.endswith(expected_key)

    stored = TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"]))
    assert stored["cvKey"] == expected_key


def test_file_name_con_path_traversal_queda_saneado(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    resp = applications.cv_upload_url(api_event(
        body={"fileName": "../../globex/cvs/x/../evil.pdf", "contentType": "application/pdf"},
        path=_path(app)), None)
    assert resp["statusCode"] == 200
    key = body(resp)["cvKey"]
    assert key == f"tenants/acme/cvs/{app['applicationId']}/evil.pdf"
    assert ".." not in key


def test_cv_download_url(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    assert applications.cv_download_url(api_event(path=_path(app)), None)["statusCode"] == 404

    key = body(applications.cv_upload_url(api_event(
        body={"fileName": "cv.pdf", "contentType": "application/pdf"}, path=_path(app)), None))["cvKey"]
    resp = applications.cv_download_url(api_event(role="MANAGER", path=_path(app)), None)
    assert resp["statusCode"] == 200
    url = body(resp)["downloadUrl"]
    assert urlparse(url).path.endswith(key)
    assert "X-Amz-Expires=300" in url

    missing = {"jobId": app["jobId"], "applicationId": "nope"}
    assert applications.cv_download_url(api_event(path=missing), None)["statusCode"] == 404
