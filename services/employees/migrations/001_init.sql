CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS positions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         VARCHAR(100) NOT NULL,
  department_id UUID NOT NULL REFERENCES departments(id),
  min_salary    NUMERIC(10,2),
  max_salary    NUMERIC(10,2),
  UNIQUE (title, department_id)
);

CREATE TABLE IF NOT EXISTS employees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       VARCHAR(80)  NOT NULL,
  last_name        VARCHAR(80)  NOT NULL,
  email            VARCHAR(254) NOT NULL UNIQUE,
  document_number  VARCHAR(20)  NOT NULL UNIQUE,
  phone            VARCHAR(30),
  hire_date        DATE NOT NULL,
  termination_date DATE,
  status           VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'TERMINATED')),
  salary           NUMERIC(10,2) NOT NULL CHECK (salary >= 0),
  department_id    UUID REFERENCES departments(id),
  position_id      UUID REFERENCES positions(id),
  manager_id       UUID REFERENCES employees(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager    ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_status     ON employees(status);