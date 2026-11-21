CREATE TABLE IF NOT EXISTS payroll_employees (
  employee_id      UUID PRIMARY KEY,
  email            VARCHAR(254) NOT NULL,
  full_name        VARCHAR(161) NOT NULL,
  base_salary      NUMERIC(10,2) NOT NULL CHECK (base_salary >= 0),
  hire_date        DATE NOT NULL,
  termination_date DATE CHECK (termination_date >= hire_date),
  status           VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'TERMINATED')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_records (
  request_id UUID PRIMARY KEY,
  email      VARCHAR(254) NOT NULL,
  type       VARCHAR(8) NOT NULL CHECK (type IN ('VACATION', 'SICK', 'PERSONAL')),
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL CHECK (end_date >= start_date),
  days       INTEGER NOT NULL CHECK (days > 0)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period       VARCHAR(7) NOT NULL UNIQUE CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status       VARCHAR(10) NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  processed    INTEGER NOT NULL DEFAULT 0 CHECK (processed >= 0),
  total_gross  NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_net    NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by   VARCHAR(254) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payslips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES payroll_runs(id),
  employee_id       UUID NOT NULL,
  email             VARCHAR(254) NOT NULL,
  period            VARCHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  base_salary       NUMERIC(10,2) NOT NULL CHECK (base_salary >= 0),
  unpaid_leave_days INTEGER NOT NULL CHECK (unpaid_leave_days >= 0),
  gross             NUMERIC(10,2) NOT NULL CHECK (gross >= 0),
  pension_deduction NUMERIC(10,2) NOT NULL CHECK (pension_deduction >= 0),
  leave_deduction   NUMERIC(10,2) NOT NULL CHECK (leave_deduction >= 0),
  net               NUMERIC(10,2) NOT NULL,
  document_key      TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_records_email_dates ON leave_records(email, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_payslips_email_period ON payslips(email, period DESC);
