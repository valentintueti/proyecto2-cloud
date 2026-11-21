ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS next_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_offset >= 0);

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS batch_offset INTEGER NOT NULL DEFAULT 0 CHECK (batch_offset >= 0);

CREATE INDEX IF NOT EXISTS idx_payslips_run_batch ON payslips(run_id, batch_offset);
