"""Vacantes: listar, crear, ver y editar."""
from common.db_dynamo import TenantTable
from common.http import (
    created, get_limit, handle_errors, not_found, ok, parse_body, path_param, query_param,
)
from common.tenant import get_auth_context, require_role
from src import repository as repo


@handle_errors
def list_jobs(event, context):
    ctx = get_auth_context(event)
    items, next_cursor = repo.list_jobs(
        TenantTable(ctx["tenantId"]), query_param(event, "status"),
        limit=get_limit(event), cursor=query_param(event, "cursor"),
    )
    return ok({"items": [repo.public(i) for i in items], "nextCursor": next_cursor})


@handle_errors
def create_job(event, context):
    ctx = require_role(event, "ADMIN_RRHH")
    job = repo.new_job(parse_body(event), ctx["userId"])
    saved = TenantTable(ctx["tenantId"]).put(repo.job_sk(job["jobId"]), job, if_not_exists=True)
    return created(repo.public(saved))


@handle_errors
def get_job(event, context):
    ctx = get_auth_context(event)
    job = TenantTable(ctx["tenantId"]).get(repo.job_sk(path_param(event, "jobId")))
    if job is None:
        return not_found("Vacante no encontrada")
    return ok(repo.public(job))


@handle_errors
def update_job(event, context):
    ctx = require_role(event, "ADMIN_RRHH")
    changes = repo.job_changes(parse_body(event))
    updated = TenantTable(ctx["tenantId"]).update(repo.job_sk(path_param(event, "jobId")), changes)
    if updated is None:
        return not_found("Vacante no encontrada")
    return ok(repo.public(updated))
