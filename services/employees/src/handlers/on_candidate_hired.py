"""Consumidor SQS: un candidato contratado en recruitment se vuelve empleado."""
import logging

from common import db_pg, events
from common.events import sqs_batch
from src import repository as repo
from src import schemas as s

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _optional_uuid(value):
    try:
        return s.parse_uuid(value) if value else None
    except ValueError:
        return None


def _employee_from_candidate(conn, data: dict) -> dict:
    department_id = _optional_uuid(data.get("departmentId"))
    if department_id and not repo.department_exists(conn, department_id):
        department_id = None

    position = None
    if data.get("positionTitle"):
        position = repo.find_position_by_title(conn, str(data["positionTitle"]).strip(), department_id)

    employee = s.new_employee({
        "firstName": data.get("firstName"),
        "lastName": data.get("lastName"),
        "email": data.get("email"),
        "documentNumber": s.provisional_document(data.get("applicationId")),
        "hireDate": data.get("startDate"),
        "salary": data.get("salary") or 0,
    })
    if position:
        employee["position_id"] = str(position["id"])
        department_id = department_id or str(position["department_id"])
    if department_id:
        employee["department_id"] = department_id
    return employee


@sqs_batch
def handler(message, context):
    if message["eventType"] != "CandidateHired":
        logger.info("Evento ignorado: %s", message["eventType"])
        return
    tenant_id = message["tenantId"]
    data = message.get("data") or {}

    with db_pg.with_tenant(tenant_id) as conn:
        emp = repo.get_employee_by_email(conn, s.normalize_email(data.get("email")))
        if emp is None:
            emp = repo.insert_employee(conn, _employee_from_candidate(conn, data))

    # Se publica también si ya existía: si un intento anterior falló al publicar,
    # el evento no se pierde. Los consumidores de EmployeeCreated son idempotentes.
    events.publish("EmployeeCreated", tenant_id, s.employee_created_data(emp))