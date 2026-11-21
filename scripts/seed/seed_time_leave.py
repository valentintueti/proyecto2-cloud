"""time_leave: asistencias (85 %), solicitudes (10 %) y saldos (5 %) en la tabla de time_leave."""
from datetime import datetime, timedelta, timezone

from context import write_items
from people import TODAY, rng, utc_iso

LIMA = timezone(timedelta(hours=-5))
ATTENDANCE_DAYS = 20
VACATION_DAYS = 30


def _last_weekdays(count: int) -> list:
    days, day = [], TODAY - timedelta(days=1)
    while len(days) < count:
        if day.weekday() < 5:
            days.append(day)
        day -= timedelta(days=1)
    return list(reversed(days))


def attendance(company, total: int):
    pk, r = f"TENANT#{company.tenant}", rng(company.tenant, "attendance")
    days = _last_weekdays(ATTENDANCE_DAYS)
    written = 0
    for person in company.people:
        for day in days:
            if written >= total:
                return
            if not person.employed_on(day):
                continue
            check_in = datetime(day.year, day.month, day.day, 8, 30, tzinfo=LIMA) + timedelta(minutes=r.randint(0, 45))
            check_out = datetime(day.year, day.month, day.day, 17, 30, tzinfo=LIMA) + timedelta(minutes=r.randint(0, 75))
            yield {
                "PK": pk,
                "SK": f"ATT#{person.email}#{day.isoformat()}",
                "tenantId": company.tenant,
                "email": person.email,
                "date": day.isoformat(),
                "checkIn": check_in.isoformat(),
                "checkOut": check_out.isoformat(),
                "workedMinutes": int((check_out - check_in).total_seconds() // 60),
            }
            written += 1


def leave_items(company):
    tenant, pk = company.tenant, f"TENANT#{company.tenant}"
    for leave in company.leaves:
        item = {
            "PK": pk,
            "SK": f"LEAVE#{leave.id}",
            "tenantId": tenant,
            "GSI1PK": f"{pk}#EMP#{leave.person.email}",
            "GSI1SK": f"LEAVE#{leave.start.isoformat()}",
            "GSI2PK": f"{pk}#LEAVE#{leave.status}",
            "GSI2SK": f"{leave.start.isoformat()}#{leave.id}",
            "requestId": leave.id,
            "email": leave.person.email,
            "type": leave.type,
            "startDate": leave.start.isoformat(),
            "endDate": leave.end.isoformat(),
            "days": leave.days,
            "reason": "Solicitud de prueba",
            "status": leave.status,
            "createdAt": leave.created_at,
        }
        if leave.status in ("APPROVED", "REJECTED", "CANCELLED"):
            item["decidedBy"] = leave.decided_by or leave.person.email   # CANCELLED lo decide el dueño
            item["decidedAt"] = utc_iso(leave.start - timedelta(days=1), 13)
        yield item


def balance_items(company, total: int):
    pk, year = f"TENANT#{company.tenant}", TODAY.year
    used = {}
    for leave in company.leaves:
        if leave.status == "APPROVED" and leave.type == "VACATION" and leave.start.year == year:
            used[leave.person.email] = used.get(leave.person.email, 0) + leave.days
    for person in company.people[:total]:
        yield {
            "PK": pk,
            "SK": f"BALANCE#{person.email}#{year}",
            "tenantId": company.tenant,
            "email": person.email,
            "year": year,
            "vacationDays": VACATION_DAYS,
            "usedDays": min(VACATION_DAYS, used.get(person.email, 0)),
        }


def items(company):
    leaves = len(company.leaves)
    attendance_total = company.size * 85 // 100
    balances = max(0, company.size - attendance_total - leaves)
    yield from attendance(company, attendance_total)
    yield from leave_items(company)
    yield from balance_items(company, balances)


def seed(ctx, company) -> int:
    return write_items(ctx.table("time_leave"), items(company))
