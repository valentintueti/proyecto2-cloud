## Convenciones del equipo

### Alcance de los issues
- Los issues de servicios incluyen solo código Python (handlers, módulos, tests), migrations SQL y
  diagramas/estructuras JSON en `docs/`.
- `serverless.yml`, `package.json`, `requirements.txt`, infraestructura, datos de prueba y despliegue
  **no** son parte de los issues. Si necesitas una librería o una variable de entorno nueva, indícalo en el PR.

### Ramas y PRs
- Una rama por issue: `feat/<servicio>` (ej. `feat/employees`).
- PR hacia `main` con al menos 1 revisión. Nada de push directo a `main`.
- No subir `.env`, `.venv/`, `__pycache__/`, `.pytest_cache/`.

### Estructura de un servicio
```
services/<nombre>/
├── src/
│   ├── repository.py       # validación y armado de ítems/filas
│   └── handlers/*.py       # un archivo por recurso
├── migrations/*.sql        # solo servicios RDS
└── tests/
    ├── conftest.py
    └── test_*.py
```
- `src/` y `src/handlers/` sin `__init__.py`. Imports: `from src import repository`.
- Handler HTTP: `def nombre(event, context)` decorado con `@handle_errors`.
- Consumidor SQS: decorado con `@sqs_batch`; recibe `(message, context)`, con el mensaje ya parseado.
- `services/identity` es la referencia: copiar la estructura, el `conftest.py` y el estilo.

### Usar `shared/python/common` (no reescribirlo ni copiarlo)
- `common.http`: `handle_errors`, `ok`, `created`, `no_content`, `not_found`, `parse_body`,
  `require_fields`, `path_param`, `query_param`, `get_limit`, `ConflictError`
- `common.tenant`: `require_role(event, *roles)` devuelve `{"tenantId", "userId", "role"}`;
  `get_auth_context(event)`; `tenant_pk(tenant_id)`
- `common.db_dynamo`: `TenantTable(tenant_id)` con `put`, `get`, `query`, `update`, `delete`; `get_table()`
- `common.db_pg`: `with_tenant(tenant_id)`, `query(conn, sql, **params)`, `create_tenant_schema(...)`
- `common.events`: `publish(event_type, tenant_id, data)`, `@sqs_batch`
- `common.storage`: S3 bajo `tenants/{tenantId}/`

Si falta algo en `common`, se pide en el PR.

### Reglas
- **Multi-tenant:** el `tenantId` sale SOLO de `require_role(...)` / `get_auth_context(...)`.
  Nunca del body, query string ni path.
- `userId` del JWT = email del usuario.
- Roles: `ADMIN_RRHH`, `MANAGER`, `EMPLOYEE`.
- Errores: datos inválidos → `ValueError` (400); duplicado → `ConflictError` (409);
  sin permiso → `PermissionError` (403). `handle_errors` los convierte.
- Tests con `pytest` + `moto`, por servicio: `python -m pytest services/<nombre>/tests -v`

### Contrato de eventos
Sobre común (lo arma `common.events.publish`): `{eventId, eventType, tenantId, source, occurredAt, data}`

| Evento | Publica | Consume | `data` |
|---|---|---|---|
| `TenantCreated` | identity | employees, payroll | `{name, plan, adminEmail}` |
| `CandidateHired` | recruitment | employees | `{applicationId, jobId, email, firstName, lastName, positionTitle, departmentId?, salary?, startDate}` |
| `EmployeeCreated` | employees | identity, time_leave, payroll | `{employeeId, email, fullName, hireDate, departmentId?, managerEmail?}` |
| `EmployeeTerminated` | employees | identity, payroll | `{employeeId, email, terminationDate}` |
| `LeaveApproved` | time_leave | payroll, notifications | `{requestId, email, type, startDate, endDate, days, approvedBy}` |