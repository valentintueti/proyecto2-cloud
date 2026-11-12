"""Saldo de vacaciones del usuario autenticado."""
from common.db_dynamo import TenantTable
from common.http import handle_errors, ok
from common.tenant import get_auth_context
from src import repository as repo


@handle_errors
def my_balance(event, context):
    ctx = get_auth_context(event)
    email = repo.normalize_email(ctx["userId"])
    balance = repo.get_balance(TenantTable(ctx["tenantId"]), email, repo.now_lima().year)
    return ok(repo.public_balance(balance))
