"""Pure calculations for a monthly TalentCloud payslip."""

from calendar import monthrange
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal


DAILY_SALARY_DIVISOR = 30
PENSION_RATE = Decimal("0.13")
CENT = Decimal("0.01")


@dataclass(frozen=True)
class ApprovedLeave:
    kind: Literal["PERSONAL", "VACATION", "SICK"]
    start_date: date
    end_date: date


@dataclass(frozen=True)
class PayslipAmounts:
    unpaid_leave_days: int
    gross: Decimal
    pension_deduction: Decimal
    leave_deduction: Decimal
    net: Decimal


def _money(amount: Decimal) -> Decimal:
    return amount.quantize(CENT, rounding=ROUND_HALF_UP)


def calculate_payslip(
    *,
    base_salary: Decimal,
    period: date,
    hire_date: date,
    termination_date: date | None = None,
    approved_leaves: Iterable[ApprovedLeave] = (),
) -> PayslipAmounts:
    """Calculate pay for the calendar month containing ``period``.

    Employment dates and leave dates are inclusive. As in Time and Leave,
    approved leave counts Monday through Friday. All inputs belong to one
    employee and the caller supplies only approved leave.
    """
    if not base_salary.is_finite() or base_salary < 0:
        raise ValueError("base_salary must be a finite, non-negative amount")
    if termination_date is not None and termination_date < hire_date:
        raise ValueError("termination_date must be on or after hire_date")

    month_start = period.replace(day=1)
    month_end = period.replace(day=monthrange(period.year, period.month)[1])
    employed_from = max(month_start, hire_date)
    employed_until = min(month_end, termination_date or month_end)
    employed_days = max(0, (employed_until - employed_from).days + 1)

    if employed_days == month_end.day:
        gross = _money(base_salary)
    else:
        prorated_gross = base_salary * employed_days / DAILY_SALARY_DIVISOR
        gross = _money(min(base_salary, prorated_gross))

    unpaid_dates: set[date] = set()
    for leave in approved_leaves:
        if leave.kind != "PERSONAL":
            continue
        start = max(employed_from, leave.start_date)
        end = min(employed_until, leave.end_date)
        for offset in range((end - start).days + 1):
            leave_date = start + timedelta(days=offset)
            if leave_date.weekday() < 5:
                unpaid_dates.add(leave_date)

    unpaid_leave_days = len(unpaid_dates)
    pension_deduction = _money(gross * PENSION_RATE)
    leave_deduction = _money(base_salary * unpaid_leave_days / DAILY_SALARY_DIVISOR)
    net = _money(gross - pension_deduction - leave_deduction)
    return PayslipAmounts(unpaid_leave_days, gross, pension_deduction, leave_deduction, net)
