"""Bandeja de notificaciones del usuario autenticado."""
from common.http import get_limit, handle_errors, not_found, ok, path_param, query_param
from common.tenant import get_auth_context
from src import repository as repo


def _me(event: dict) -> tuple:
    ctx = get_auth_context(event)
    return ctx["tenantId"], repo.normalize_email(ctx["userId"])


@handle_errors
def my_notifications(event, context):
    tenant_id, email = _me(event)
    items, next_cursor = repo.query_user(
        tenant_id, email,
        limit=get_limit(event),
        cursor=query_param(event, "cursor"),
        unread_only=repo.parse_bool(query_param(event, "unread"), "unread"),
    )
    return ok({"items": [repo.public(i) for i in items], "nextCursor": next_cursor})


@handle_errors
def unread_count(event, context):
    tenant_id, email = _me(event)
    return ok({"unread": repo.count_unread(tenant_id, email)})


@handle_errors
def mark_read(event, context):
    tenant_id, email = _me(event)
    notif_id = repo.validate_notification_id(path_param(event, "notificationId"))
    item = repo.find_by_id(tenant_id, email, notif_id)
    if item is None:
        return not_found("Notificación no encontrada")
    return ok(repo.public(repo.mark_read(tenant_id, item)))


@handle_errors
def mark_all_read(event, context):
    tenant_id, email = _me(event)
    return ok({"updated": repo.mark_all_read(tenant_id, email)})
