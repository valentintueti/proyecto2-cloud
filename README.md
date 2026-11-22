# TalentCloud — SaaS HCM multi-tenant en AWS

Proyecto final CS2032 Cloud Computing (Grupo 2). Gestión de capital humano para varias empresas
(tenants) con arquitectura serverless y orientada a eventos.

## Arquitectura

| Servicio | Base de datos | Publica | Consume |
|---|---|---|---|
| `infra` | RDS PostgreSQL, SNS `hcm-events`, layer `common` | — | — |
| `identity` | DynamoDB | `TenantCreated` | `EmployeeCreated`, `EmployeeTerminated` |
| `employees` | RDS (`hcm_employees`, un schema por tenant) | `EmployeeCreated`, `EmployeeUpdated`, `EmployeeTerminated` | `TenantCreated`, `CandidateHired` |
| `recruitment` | DynamoDB + S3 (CVs) | `CandidateHired` | — |
| `time_leave` | DynamoDB (2 GSI) | `LeaveApproved` | `EmployeeCreated` |
| `payroll` | RDS (`hcm_payroll`, un schema por tenant) y S3 (boletas PDF) | `PayrollRunRequested`, `PayslipGenerated` | `TenantCreated`, `EmployeeCreated`, `EmployeeUpdated`, `EmployeeTerminated`, `LeaveApproved`, `PayrollRunRequested` |
| `notifications` | DynamoDB (bandeja) y SES opcional | — | `EmployeeCreated`, `LeaveApproved`, `PayslipGenerated` |
| `frontend` | — | — | APIs de los 6 servicios |

- Cada API Gateway valida el JWT con un Lambda Authorizer; el `tenantId` viaja en el token.
- DynamoDB en modelo pool (`PK = TENANT#<id>`), RDS con un schema por tenant (Patrón 2) y S3 con prefijo `tenants/<id>/`.
- Eventos: SNS → una cola SQS (con DLQ) por consumidor.
- Convenciones del equipo: [convenciones.md](convenciones.md).

## Estructura

```
services/<servicio>/   serverless.yml, src/, tests/ (y migrations/ en employees y payroll)
shared/python/common/  código compartido (se despliega como Lambda Layer)
scripts/               deploy.sh y bootstrap.py
frontend/              React + TypeScript + Vite
docs/                  modelos de datos
```

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest shared/tests -q
python -m pytest services/identity/tests -q      # uno por servicio, no todos juntos
```

Frontend: `cd frontend && npm ci && npm test && npm run build`.

## Despliegue (desde una EC2 en el Learner Lab)

### 1. VM

Ubuntu 24.04, `t3.small`, 16 GB, IAM instance profile **`LabInstanceProfile`**, en la VPC por defecto.
User data:

```bash
#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git nodejs npm python3-pip python3-venv postgresql-client unzip curl
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install
echo 'export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1' >> /home/ubuntu/.bashrc
```

Verificar: `aws sts get-caller-identity` debe mostrar `assumed-role/LabRole`.

### 2. Código y configuración

```bash
git clone <url-del-repo> && cd proyecto2-cloud
cp .env.example .env && nano .env
```

Completar `LAB_ROLE_ARN`, `JWT_SECRET`, `PLATFORM_ADMIN_KEY`, `DB_PASSWORD` y `SEED_ADMIN_PASSWORD`.
En la VM las variables `AWS_*` de credenciales quedan vacías.

### 3. Desplegar

```bash
bash scripts/deploy.sh
```

Despliega en orden `infra → employees → identity → recruitment → time_leave → payroll → notifications` (la RDS tarda ~10 min
la primera vez) y al final imprime la URL de cada API. Para un solo servicio, usa `bash scripts/deploy.sh payroll`.

### 4. Bases y tenants

```bash
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/bootstrap.py
```

Crea las bases `hcm_employees` y `hcm_payroll`, aplica las migraciones de ambos servicios a los esquemas de
`TENANTS` y registra en Identidad las empresas que falten. Cada empresa nueva queda con el administrador
`admin@<tenant>.com` y la contraseña `SEED_ADMIN_PASSWORD`.

Al integrar Payroll en un entorno existente, vuelve a ejecutar el bootstrap con los tenants que quieras
incorporar. El script copia la ficha laboral vigente de Empleados a Payroll y conserva los perfiles que
Payroll ya tenga más actualizados. Las ausencias aprobadas antes de desplegar Payroll requieren una carga
histórica aparte si se van a usar en una corrida.

### 4b. Datos de prueba

```bash
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/seed/run.py
.venv/bin/python scripts/seed/verify.py
```

- Escribe **directo** en DynamoDB y RDS: no pasa por API Gateway ni Lambda y no publica eventos
  (cargarlo por la API supera los límites del Learner Lab).
- Por cada tenant de `TENANTS` genera `SEED_RECORDS_PER_TENANT` empleados (10 000 por defecto) y, a partir de
  la misma lista, al menos esa cantidad de registros en cada microservicio: usuarios, empleados, vacantes y
  postulaciones, asistencias, solicitudes y saldos, fichas y boletas de planilla, y notificaciones.
- Usuarios: `empleado1@<tenant>.com` a `empleado10000@<tenant>.com` (los 10 primeros son jefes), con la
  contraseña `SEED_ADMIN_PASSWORD`. `empleado1` a `empleado20` siempre están activos y tienen datos en todos
  los módulos, incluida la boleta en PDF.
- Se puede volver a ejecutar sin duplicar (ids determinísticos). Opciones: `--tenants acme`,
  `--per-tenant 10000`, `--services identity,employees`.
- `verify.py` muestra el conteo por servicio y tenant y marca con `*` lo que no llega al mínimo.
- Tests: `python -m pytest scripts/seed/tests -q`.

### 5. Frontend (Amplify)

Conectar el repo en Amplify con `frontend/` como raíz de la app y configurar
`VITE_IDENTITY_API_URL`, `VITE_EMPLOYEES_API_URL`, `VITE_RECRUITMENT_API_URL`, `VITE_TIMELEAVE_API_URL`,
`VITE_PAYROLL_API_URL` y `VITE_NOTIFICATIONS_API_URL` con las URLs del paso 3. `VITE_SIGNUP_ENABLED` queda en
`false` hasta que identity tenga `POST /signup`. Luego poner la URL de Amplify en `FRONTEND_ORIGIN` y redesplegar recruitment
(`bash scripts/deploy.sh recruitment`) para el CORS del bucket de CVs.

### Al reiniciar el Learner Lab

La RDS y la VM se detienen. Al volver: encender la VM (la RDS arranca sola con el lab) y seguir;
no hace falta redesplegar.
