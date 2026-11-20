import os

import boto3

from common import storage
from common.db_dynamo import TenantTable
from src import repository as repo
from src.handlers import applications, jobs


def _path(app):
    return {"jobId": app["jobId"], "applicationId": app["applicationId"]}


def _delete_job(api_event, job_id, **kwargs):
    return jobs.delete_job(api_event(path={"jobId": job_id}, **kwargs), None)


def _delete_app(api_event, app, **kwargs):
    return applications.delete_application(api_event(path=_path(app), **kwargs), None)


def _s3_keys():
    resp = boto3.client("s3").list_objects_v2(Bucket=os.environ["BUCKET_NAME"])
    return [o["Key"] for o in resp.get("Contents", [])]


# --- DELETE /jobs/{jobId} ------------------------------------------------------

def test_delete_job_sin_postulaciones(api_event, make_job):
    job = make_job()
    resp = _delete_job(api_event, job["jobId"])
    assert resp["statusCode"] == 204
    assert resp["body"] == ""
    assert TenantTable("acme").get(repo.job_sk(job["jobId"])) is None


def test_delete_job_inexistente_es_404(api_event):
    assert _delete_job(api_event, "no-existe")["statusCode"] == 404


def test_delete_job_con_postulaciones_es_409(api_event, make_job, make_application):
    job = make_job()
    make_application(job["jobId"])
    resp = _delete_job(api_event, job["jobId"])
    assert resp["statusCode"] == 409
    assert "postulaciones" in resp["body"]
    assert TenantTable("acme").get(repo.job_sk(job["jobId"])) is not None


def test_delete_job_de_otro_tenant_es_404(api_event, make_job):
    job = make_job(tenant_id="acme")
    resp = _delete_job(api_event, job["jobId"], tenant_id="globex", user_id="admin@globex.com")
    assert resp["statusCode"] == 404
    assert TenantTable("acme").get(repo.job_sk(job["jobId"])) is not None


def test_delete_job_solo_admin(api_event, make_job):
    job = make_job()
    assert _delete_job(api_event, job["jobId"], role="MANAGER")["statusCode"] == 403
    assert _delete_job(api_event, job["jobId"], role="EMPLOYEE")["statusCode"] == 403


# --- DELETE /jobs/{jobId}/applications/{applicationId} --------------------------

def test_delete_application(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    resp = _delete_app(api_event, app)
    assert resp["statusCode"] == 204
    assert TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"])) is None
    assert _delete_app(api_event, app)["statusCode"] == 404


def test_delete_application_borra_el_cv_de_s3(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    resp = applications.cv_upload_url(
        api_event(body={"fileName": "cv.pdf", "contentType": "application/pdf"}, path=_path(app)), None,
    )
    assert resp["statusCode"] == 200
    key = TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"]))["cvKey"]
    storage.put_bytes("acme", key, b"%PDF-1.4", "application/pdf")
    assert key in _s3_keys()

    assert _delete_app(api_event, app)["statusCode"] == 204
    assert key not in _s3_keys()


def test_delete_application_hired_es_409(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    sk = repo.application_sk(app["jobId"], app["applicationId"])
    TenantTable("acme").update(sk, {"stage": "HIRED"})
    assert _delete_app(api_event, app)["statusCode"] == 409
    assert TenantTable("acme").get(sk) is not None


def test_delete_application_de_otro_tenant_es_404(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    resp = _delete_app(api_event, app, tenant_id="globex", user_id="admin@globex.com")
    assert resp["statusCode"] == 404
    assert TenantTable("acme").get(repo.application_sk(app["jobId"], app["applicationId"])) is not None


def test_delete_application_solo_admin(api_event, make_job, make_application):
    app = make_application(make_job()["jobId"])
    assert _delete_app(api_event, app, role="MANAGER")["statusCode"] == 403


def test_tras_borrar_postulaciones_se_puede_borrar_la_vacante(api_event, make_job, make_application):
    job = make_job()
    app = make_application(job["jobId"])
    assert _delete_job(api_event, job["jobId"])["statusCode"] == 409
    assert _delete_app(api_event, app)["statusCode"] == 204
    assert _delete_job(api_event, job["jobId"])["statusCode"] == 204
