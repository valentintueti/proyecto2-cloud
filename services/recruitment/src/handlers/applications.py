"""Postulaciones de una vacante: registro, CV en S3 y cambio de etapa."""
from common import storage
from common.db_dynamo import TenantTable
from common.events import publish
from common.http import (
    ConflictError, created, get_limit, handle_errors, not_found, ok, parse_body,
    path_param, query_param, require_fields,
)
from common.tenant import require_role
from src import repository as repo

RECRUITERS = ("ADMIN_RRHH", "MANAGER")


def _load_application(table: TenantTable, event: dict):
    job_id = path_param(event, "jobId")
    application_id = path_param(event, "applicationId")
    return table.get(repo.application_sk(job_id, application_id))


@handle_errors
def list_applications(event, context):
    ctx = require_role(event, *RECRUITERS)
    table = TenantTable(ctx["tenantId"])
    job_id = path_param(event, "jobId")
    if table.get(repo.job_sk(job_id)) is None:
        return not_found("Vacante no encontrada")
    items, next_cursor = table.query(
        repo.applications_prefix(job_id), limit=get_limit(event), cursor=query_param(event, "cursor"),
    )
    return ok({"items": [repo.public(i) for i in items], "nextCursor": next_cursor})


@handle_errors
def create_application(event, context):
    ctx = require_role(event, *RECRUITERS)
    table = TenantTable(ctx["tenantId"])
    job_id = path_param(event, "jobId")
    job = table.get(repo.job_sk(job_id))
    if job is None:
        return not_found("Vacante no encontrada")
    if job.get("status") != "OPEN":
        raise ValueError("La vacante no está abierta")

    body = require_fields(parse_body(event), "firstName", "lastName", "email")
    application = repo.new_application(job_id, body)
    if repo.email_already_applied(table, job_id, application["email"]):
        raise ConflictError("Ese email ya postuló a esta vacante")

    sk = repo.application_sk(job_id, application["applicationId"])
    saved = table.put(sk, application, if_not_exists=True)
    return created(repo.public(saved))


@handle_errors
def cv_upload_url(event, context):
    ctx = require_role(event, *RECRUITERS)
    tenant_id = ctx["tenantId"]
    body = require_fields(parse_body(event), "fileName", "contentType")
    if body["contentType"] != repo.CV_CONTENT_TYPE:
        raise ValueError("Solo se aceptan CVs en PDF (application/pdf)")

    table = TenantTable(tenant_id)
    application = _load_application(table, event)
    if application is None:
        return not_found("Postulación no encontrada")

    application_id = application["applicationId"]
    key = storage.tenant_key(tenant_id, "cvs", application_id, storage.safe_filename(body["fileName"]))
    url = storage.presigned_upload(tenant_id, key, repo.CV_CONTENT_TYPE)
    table.update(
        repo.application_sk(application["jobId"], application_id),
        {"cvKey": key, "updatedAt": repo.now_iso()},
    )
    return ok({"uploadUrl": url, "cvKey": key})


@handle_errors
def cv_download_url(event, context):
    ctx = require_role(event, *RECRUITERS)
    application = _load_application(TenantTable(ctx["tenantId"]), event)
    if application is None:
        return not_found("Postulación no encontrada")
    if not application.get("cvKey"):
        return not_found("La postulación no tiene CV")
    url = storage.presigned_download(ctx["tenantId"], application["cvKey"], expires_in=300)
    return ok({"downloadUrl": url})


@handle_errors
def change_stage(event, context):
    ctx = require_role(event, *RECRUITERS)
    tenant_id = ctx["tenantId"]
    table = TenantTable(tenant_id)
    application = _load_application(table, event)
    if application is None:
        return not_found("Postulación no encontrada")

    body = require_fields(parse_body(event), "stage")
    target = repo.check_transition(application["stage"], body["stage"])
    notes = repo.parse_notes(body["notes"]) if "notes" in body else None

    if target != "HIRED":
        return ok(repo.public(repo.change_stage(tenant_id, application, target, notes)))

    details = repo.hire_details(body)
    job = table.get(repo.job_sk(application["jobId"]))
    if job is None:
        return not_found("Vacante no encontrada")
    hired, job = repo.hire(tenant_id, application, job, notes)
    publish("CandidateHired", tenant_id, repo.candidate_hired_data(hired, job, details))
    return ok(repo.public(hired))
