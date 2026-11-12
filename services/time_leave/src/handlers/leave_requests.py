"""Solicitudes de vacaciones y permisos con aprobación."""
from common.db_dynamo import TenantTable
from common.events import publish
from common.http import (
    ConflictError, created, get_limit, handle_errors, not_found, ok, parse_body,
    path_param, query_param, require_fields,
)
from common.tenant import get_auth_context, require_role
from src import repository as repo

DECIDERS = ("ADMIN_RRHH", "MANAGER")


def _load(ctx: dict, event: dict):
    request_id = path_param(event, "requestId")
    return TenantTable(ctx["tenantId"]).get(repo.leave_sk(request_id))


def _check_decidable(ctx: dict, request: dict) -> str:
    me = repo.normalize_email(ctx["userId"])
    if request["email"] == me:
        raise ValueError("No puedes decidir sobre tu propia solicitud")
    if request["status"] != "PENDING":
        raise ConflictError("La solicitud ya no está pendiente")
    return me


@handle_errors
def create_request(event, context):
    ctx = get_auth_context(event)
    email = repo.normalize_email(ctx["userId"])
    body = require_fields(parse_body(event), "type", "startDate", "endDate")
    table = TenantTable(ctx["tenantId"])

    request = repo.new_leave_request(ctx["tenantId"], email, body)
    if request["type"] == "VACATION":
        balance = repo.get_balance(table, email, repo.request_year(request))
        if request["days"] > repo.available_days(balance):
            raise ConflictError("Saldo de vacaciones insuficiente")

    saved = table.put(repo.leave_sk(request["requestId"]), request, if_not_exists=True)
    return created(repo.public(saved))


@handle_errors
def my_requests(event, context):
    ctx = get_auth_context(event)
    items, next_cursor = repo.query_by_employee(
        ctx["tenantId"], repo.normalize_email(ctx["userId"]),
        limit=get_limit(event), cursor=query_param(event, "cursor"),
    )
    return ok({"items": [repo.public(i) for i in items], "nextCursor": next_cursor})


@handle_errors
def list_requests(event, context):
    ctx = require_role(event, *DECIDERS)
    items, next_cursor = repo.query_by_status(
        ctx["tenantId"], query_param(event, "status", "PENDING"),
        limit=get_limit(event), cursor=query_param(event, "cursor"),
    )
    return ok({"items": [repo.public(i) for i in items], "nextCursor": next_cursor})


@handle_errors
def approve(event, context):
    ctx = require_role(event, *DECIDERS)
    request = _load(ctx, event)
    if request is None:
        return not_found("Solicitud no encontrada")
    me = _check_decidable(ctx, request)

    if request["type"] == "VACATION":
        updated = repo.approve_vacation(ctx["tenantId"], request, me)
    else:
        updated = repo.decide(ctx["tenantId"], request["requestId"], "APPROVED", me)

    publish("LeaveApproved", ctx["tenantId"], repo.leave_approved_data(updated))
    return ok(repo.public(updated))


@handle_errors
def reject(event, context):
    ctx = require_role(event, *DECIDERS)
    request = _load(ctx, event)
    if request is None:
        return not_found("Solicitud no encontrada")
    me = _check_decidable(ctx, request)
    updated = repo.decide(ctx["tenantId"], request["requestId"], "REJECTED", me)
    return ok(repo.public(updated))


@handle_errors
def cancel(event, context):
    ctx = get_auth_context(event)
    request = _load(ctx, event)
    if request is None:
        return not_found("Solicitud no encontrada")
    me = repo.normalize_email(ctx["userId"])
    if request["email"] != me:
        raise PermissionError("Solo el dueño puede cancelar su solicitud")
    if request["status"] != "PENDING":
        raise ConflictError("Solo se pueden cancelar solicitudes pendientes")
    updated = repo.decide(ctx["tenantId"], request["requestId"], "CANCELLED", me)
    return ok(repo.public(updated))
