from datetime import date
from decimal import Decimal

import pytest

from src.calculator import ApprovedLeave, PayslipAmounts, calculate_payslip


@pytest.mark.parametrize("period", [date(2026, 2, 1), date(2028, 2, 1), date(2026, 3, 1)])
def test_full_month_pays_full_salary(period):
    result = calculate_payslip(
        base_salary=Decimal("3000"), period=period, hire_date=date(2025, 1, 1),
    )

    assert result == PayslipAmounts(
        0, Decimal("3000.00"), Decimal("390.00"), Decimal("0.00"), Decimal("2610.00"),
    )


@pytest.mark.parametrize(
    ("hire_date", "termination_date", "expected_gross"),
    [
        (date(2026, 3, 31), date(2026, 3, 31), "100.00"),
        (date(2026, 3, 16), date(2026, 3, 31), "1600.00"),
        (date(2026, 3, 2), None, "3000.00"),
        (date(2026, 4, 1), None, "0.00"),
        (date(2026, 1, 1), date(2026, 2, 28), "0.00"),
    ],
)
def test_partial_month_counts_inclusive_dates_in_the_period(
    hire_date, termination_date, expected_gross,
):
    result = calculate_payslip(
        base_salary=Decimal("3000"),
        period=date(2026, 3, 1),
        hire_date=hire_date,
        termination_date=termination_date,
    )

    assert result.gross == Decimal(expected_gross)


def test_only_personal_leave_is_unpaid_and_only_in_period():
    result = calculate_payslip(
        base_salary=Decimal("3000"),
        period=date(2026, 3, 1),
        hire_date=date(2025, 1, 1),
        approved_leaves=[
            ApprovedLeave("VACATION", date(2026, 3, 2), date(2026, 3, 3)),
            ApprovedLeave("SICK", date(2026, 3, 4), date(2026, 3, 4)),
            ApprovedLeave("PERSONAL", date(2026, 3, 27), date(2026, 4, 2)),
            ApprovedLeave("PERSONAL", date(2026, 3, 30), date(2026, 3, 31)),
        ],
    )

    assert result == PayslipAmounts(
        3, Decimal("3000.00"), Decimal("390.00"), Decimal("300.00"), Decimal("2310.00"),
    )


def test_personal_leave_counts_only_dates_during_employment():
    result = calculate_payslip(
        base_salary=Decimal("3000"),
        period=date(2026, 3, 1),
        hire_date=date(2026, 3, 16),
        termination_date=date(2026, 3, 17),
        approved_leaves=[ApprovedLeave("PERSONAL", date(2026, 3, 13), date(2026, 3, 16))],
    )

    assert result == PayslipAmounts(
        1, Decimal("200.00"), Decimal("26.00"), Decimal("100.00"), Decimal("74.00"),
    )


def test_rounds_line_items_to_cents_and_net_matches_the_payslip():
    result = calculate_payslip(
        base_salary=Decimal("1000.05"),
        period=date(2026, 3, 1),
        hire_date=date(2026, 3, 30),
        approved_leaves=[ApprovedLeave("PERSONAL", date(2026, 3, 30), date(2026, 3, 30))],
    )

    assert result == PayslipAmounts(
        1, Decimal("66.67"), Decimal("8.67"), Decimal("33.34"), Decimal("24.66"),
    )
