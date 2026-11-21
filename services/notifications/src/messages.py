"""Texto de cada notificación según el evento que la origina."""

LEAVE_LABELS = {
    "VACATION": "vacaciones",
    "SICK": "descanso médico",
    "PERSONAL": "permiso personal",
}


def _employee_created(data: dict) -> list:
    name = data.get("fullName") or data["email"]
    drafts = [{
        "email": data["email"],
        "type": "WELCOME",
        "title": "¡Bienvenido(a)!",
        "message": f"Hola {name}, tu cuenta ya está lista. Tu fecha de ingreso es {data.get('hireDate', '-')}.",
        "link": "/",
    }]
    manager = data.get("managerEmail")
    if manager and str(manager).strip().lower() != str(data["email"]).strip().lower():
        drafts.append({
            "email": manager,
            "type": "NEW_TEAM_MEMBER",
            "title": "Nuevo integrante en tu equipo",
            "message": f"{name} se une a tu equipo desde el {data.get('hireDate', '-')}.",
            "link": "/employees",
        })
    return drafts


def _leave_approved(data: dict) -> list:
    label = LEAVE_LABELS.get(data.get("type"), "permiso")
    return [{
        "email": data["email"],
        "type": "LEAVE_APPROVED",
        "title": "Solicitud aprobada",
        "message": (
            f"Tu solicitud de {label} del {data['startDate']} al {data['endDate']} "
            f"({data['days']} días hábiles) fue aprobada por {data.get('approvedBy', 'tu jefe')}."
        ),
        "link": "/leave",
    }]


def _payslip_generated(data: dict) -> list:
    """data: {runId, payslipId, email, period (YYYY-MM), net}."""
    period = data.get("period")
    detail = f" de {period}" if period else ""
    net = data.get("net")
    amount = f" Neto: S/ {float(net):,.2f}." if net is not None else ""
    return [{
        "email": data["email"],
        "type": "PAYSLIP_READY",
        "title": "Boleta de pago disponible",
        "message": f"Tu boleta de pago{detail} ya está disponible.{amount}",
        "link": "/payroll",
    }]


BUILDERS = {
    "EmployeeCreated": _employee_created,
    "LeaveApproved": _leave_approved,
    "PayslipGenerated": _payslip_generated,
}


def build(event_type: str, data: dict) -> list:
    """Borradores {email, type, title, message, link} para un evento. [] si no aplica."""
    builder = BUILDERS.get(event_type)
    if builder is None:
        return []
    if not data.get("email"):
        raise ValueError(f"{event_type} sin email")
    return builder(data)
