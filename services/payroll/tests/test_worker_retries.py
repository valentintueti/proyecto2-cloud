"""Reintentos del worker de planilla (sin PostgreSQL)."""
import json
from contextlib import contextmanager
from uuid import uuid4

import pytest

from common import db_pg
from src import repository as repo
from src.handlers import on_payroll_run_requested as worker


def _record(receive_count=None, offset=0):
    body = {"eventType": "PayrollRunRequested", "tenantId": "acme",
            "data": {"runId": str(uuid4()), "period": "2026-10", "offset": offset}}
    record = {"messageId": "m1", "body": json.dumps(body)}
    if receive_count is not None:
        record["attributes"] = {"ApproximateReceiveCount": str(receive_count)}
    return {"Records": [record]}


@pytest.fixture
def failing_run(monkeypatch):
    """El lote falla siempre; registra si la corrida se marco FAILED."""
    calls = []

    def boom(*args, **kwargs):
        raise RuntimeError("error puntual de S3")

    @contextmanager
    def fake_with_tenant(tenant_id, db_name=None):
        yield object()

    monkeypatch.setattr(worker, "_persist_batch", boom)
    monkeypatch.setattr(db_pg, "with_tenant", fake_with_tenant)
    monkeypatch.setattr(repo, "fail_batch", lambda conn, run_id, offset: calls.append(offset))
    return calls


@pytest.mark.parametrize("receive_count", [1, 2])
def test_not_final_attempt_retries_without_failing_run(failing_run, receive_count):
    assert worker.handler(_record(receive_count), None) == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
    assert failing_run == []


def test_final_attempt_marks_run_failed(failing_run):
    assert worker.handler(_record(3), None) == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
    assert failing_run == [0]


def test_missing_attribute_is_treated_as_final_attempt(failing_run):
    worker.handler(_record(None), None)
    assert failing_run == [0]


def test_invalid_offset_is_reported_without_touching_db(failing_run):
    assert worker.handler(_record(1, offset=-1), None) == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
    assert failing_run == []


def test_other_events_are_ignored(failing_run):
    event = {"Records": [{"messageId": "m1", "body": json.dumps(
        {"eventType": "TenantCreated", "tenantId": "acme", "data": {}})}]}
    assert worker.handler(event, None) == {"batchItemFailures": []}
