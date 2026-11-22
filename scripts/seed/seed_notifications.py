"""notifications: una notificación por empleado (vacaciones aprobadas, boleta o bienvenida)."""
import uuid
from datetime import timedelta

from context import write_items
from people import DEMO_USERS, TODAY, rng, stable_id

LEAVE_LABELS = {"VACATION": "vacaciones", "SICK": "descanso médico", "PERSONAL": "permiso personal"}


def previous_period() -> str:
    return (TODAY.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")


def _z(day, hour) -> str:
    return f"{day.isoformat()}T{hour:02d}:00:00Z"


def items(company):
    tenant, pk = company.tenant, f"TENANT#{company.tenant}"
    r = rng(tenant, "notifications")
    approved = {}
    for leave in company.leaves:
        if leave.status == "APPROVED":
            approved.setdefault(leave.person.email, leave)
    period = previous_period()
    last_month = TODAY.replace(day=1) - timedelta(days=1)

    for person in company.people:
        leave = approved.get(person.email)
        if leave:
            kind, link = "LEAVE_APPROVED", "/leave"
            title = "Solicitud aprobada"
            message = (f"Tu solicitud de {LEAVE_LABELS[leave.type]} del {leave.start} al {leave.end} "
                       f"({leave.days} días hábiles) fue aprobada por {leave.decided_by}.")
            created = _z(min(TODAY, leave.start - timedelta(days=1)), 13)
        elif person.employed_on(last_month):
            kind, link = "PAYSLIP_READY", "/payslips"
            title = "Boleta de pago disponible"
            message = f"Tu boleta de pago de {period} ya está disponible."
            created = _z(TODAY.replace(day=1), 10)
        else:
            kind, link = "WELCOME", "/"
            title = "¡Bienvenido(a)!"
            message = f"Hola {person.full_name}, tu cuenta ya está lista. Tu fecha de ingreso es {person.hire_date}."
            created = _z(person.hire_date, 9)
        notification_id = stable_id(tenant, "notification", person.n)
        yield {
            "PK": pk,
            "SK": f"NOTIF#{person.email}#{created}#{notification_id}",
            "tenantId": tenant,
            "notificationId": notification_id,
            "email": person.email,
            "type": kind,
            "title": title,
            "message": message,
            "link": link,
            "read": False if person.n <= DEMO_USERS else r.random() < 0.5,
            "sourceEventId": str(uuid.UUID(notification_id)),
            "createdAt": created,
        }


def seed(ctx, company) -> int:
    return write_items(ctx.table("notifications"), items(company))
