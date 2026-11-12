import pytest
from pg8000.exceptions import DatabaseError

from common.http import ConflictError
from src import repository as repo


class RecordingConn:
    """Imita pg8000.native.Connection: graba cada run() y devuelve resultados preparados."""

    def __init__(self, results=None, error=None):
        self.calls, self.results, self.error, self.columns = [], list(results or []), error, None

    def run(self, sql, **params):
        self.calls.append((sql, params))
        if self.error:
            raise self.error
        columns, rows = self.results.pop(0) if self.results else ([], [])
        self.columns = [{"name": c} for c in columns] or None
        return rows


def test_list_never_puts_user_data_in_sql():
    evil = "x'; DROP TABLE employees; --"
    conn = RecordingConn(results=[(["total"], [[0]]), ([], [])])
    repo.list_employees(conn, limit=10, offset=0, q=evil, status="ACTIVE")
    for sql, _ in conn.calls:
        assert evil not in sql and "DROP" not in sql
    assert conn.calls[1][1]["q"] == f"%{evil}%"
    assert conn.calls[1][1]["limit"] == 10


def test_like_wildcards_are_escaped():
    conn = RecordingConn(results=[(["total"], [[0]]), ([], [])])
    repo.list_employees(conn, limit=10, offset=0, q="50%_off")
    assert conn.calls[0][1]["q"] == "%50\\%\\_off%"


def test_unique_violation_becomes_conflict():
    conn = RecordingConn(error=DatabaseError({"C": "23505", "n": "employees_email_key"}))
    with pytest.raises(ConflictError, match="email"):
        repo.insert_employee(conn, {"email": "a@acme.com"})


def test_fk_violation_becomes_value_error():
    conn = RecordingConn(error=DatabaseError({"C": "23503", "n": "employees_manager_id_fkey"}))
    with pytest.raises(ValueError, match="Referencia") as exc:
        repo.insert_employee(conn, {"manager_id": "x"})
    assert not isinstance(exc.value, ConflictError)


def test_other_db_errors_propagate():
    conn = RecordingConn(error=DatabaseError({"C": "42P01"}))
    with pytest.raises(DatabaseError):
        repo.insert_employee(conn, {"email": "a@acme.com"})


def test_only_whitelisted_columns_can_be_written():
    with pytest.raises(RuntimeError):
        repo.update_employee(RecordingConn(), "id", {"status": "TERMINATED"})
    with pytest.raises(RuntimeError):
        repo.insert_employee(RecordingConn(), {"id": "x"})