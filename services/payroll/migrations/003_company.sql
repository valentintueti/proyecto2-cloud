-- Nombre de la empresa para las boletas (llega en el evento TenantCreated). Una sola fila por schema.
CREATE TABLE IF NOT EXISTS company_profile (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  name       VARCHAR(100) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
