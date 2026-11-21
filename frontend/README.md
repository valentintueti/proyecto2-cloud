# TalentCloud HCM — Frontend

Frontend del SaaS HCM multi-tenant (Issues #4 y #15). Consume las APIs de **identity**, **employees**,
**recruitment**, **time & leave**, **payroll** y, si está configurada, **notifications**.

- **Stack:** React 19 + TypeScript + Vite 6, React Router 7 e íconos `lucide-react`. Los estilos son CSS propio, sin librería de UI.
- **Pruebas:** Vitest.
- **Despliegue:** no forma parte de este issue.

## Requisitos

- Node.js 20 o superior (probado con Node 24) y npm.

## Instalación y ejecución

```bash
cd frontend
npm install
cp .env.example .env          # completa las URLs de cada API
npm run dev                   # http://localhost:5173
```

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente |
| `npm run build` | Compila con TypeScript (`tsc -b`) y genera `dist/` |
| `npm run preview` | Sirve el build de `dist/` |
| `npm run typecheck` | Solo el chequeo de tipos |
| `npm test` | Pruebas unitarias (Vitest) |

## Configuración

Todas las URLs salen de variables de entorno. No hay URLs ni secretos escritos en el código.

| Variable | Servicio |
|---|---|
| `VITE_IDENTITY_API_URL` | identity (`/auth/login`, `/me`, `/users`) |
| `VITE_EMPLOYEES_API_URL` | employees (`/employees`, `/departments`, `/positions`) |
| `VITE_RECRUITMENT_API_URL` | recruitment (`/jobs`, postulaciones y CV) |
| `VITE_TIMELEAVE_API_URL` | time & leave (`/attendance`, `/leave-requests`, `/balances`) |
| `VITE_PAYROLL_API_URL` | payroll (`/payroll-runs`, `/payslips`) |
| `VITE_NOTIFICATIONS_API_URL` | notifications (`/notifications`). **Opcional** |

- **Formato:** cada valor es la URL base del API Gateway incluyendo el stage, por ejemplo `https://xxxx.execute-api.us-east-1.amazonaws.com/dev`. El `/` final es opcional.
- **Si falta una variable:** la pantalla de login lo avisa, y las llamadas a ese servicio muestran un error claro sin hacer la petición.
- **`VITE_NOTIFICATIONS_API_URL` vacía:** la app funciona igual, no se muestra la campana y no se hace ninguna petición a Notifications (no aparece como variable faltante).

### Modo demo (solo desarrollo)

Mientras los microservicios no estén desplegados, la interfaz se puede probar con un backend simulado.

```bash
# frontend/.env.development.local  (ignorado por git)
VITE_USE_MOCKS=true
```

- **Cuándo funciona:** solo con `npm run dev`. En `npm run build`, `import.meta.env.DEV` es `false`, así que el código de `src/mocks/` se elimina del bundle.
- **En producción:** nunca se simulan respuestas. Se comprobó que `dist/` no contiene el código del backend simulado.
- **Cómo se reconoce:** la interfaz muestra el distintivo **DEMO**.
- **Fidelidad:** el backend simulado reproduce las reglas de los handlers reales: roles, validaciones, transiciones de etapa, saldo de vacaciones y errores `{error}`.
- **Datos:** viven en memoria y se reinician al recargar la página.
- **Credenciales ficticias:** empresas `acme` y `globex`; usuarios `admin@<empresa>.com`, `manager@<empresa>.com` y `empleado@<empresa>.com`; contraseña `demo1234`.
- **Issue #15 en el modo demo:**
  - Payroll: historial con dos corridas completadas y una **fallida** para probar «Reintentar». Una corrida nueva pasa 3 s en `PENDING` y luego procesa unos 3 empleados por segundo.
  - Borrados: hay usuarios sin empleado vinculado (`reclutadora@`, `auditor@`) y una vacante cerrada sin postulaciones. Los usuarios vinculados a un empleado responden 409.
  - Registro: `POST /signup` crea la empresa en memoria; employees y payroll responden 503 durante 7 s.
  - Notificaciones: 14 por usuario (3 sin leer) con los tipos reales (`LEAVE_APPROVED`, `PAYSLIP_READY`…) y una de prueba con enlace externo que se bloquea.
  - La descarga de boletas abre un texto simulado (no un PDF real).

## Arquitectura

```
src/
├── api/            # Capa HTTP: un módulo por microservicio + tipos de respuestas
│   ├── http.ts     #   cliente común: base URL, Bearer, 401 → logout, errores, 204 sin cuerpo, PUT a S3
│   ├── identity.ts · employees.ts · recruitment.ts · timeLeave.ts
│   ├── payroll.ts · notifications.ts
│   └── types.ts    #   tipos de cada API (usuario, empleado, vacante, postulación, solicitud…)
├── auth/           # Sesión (JWT), permisos por rol y guards de rutas
├── components/
│   ├── layout/     # Sidebar, header (tenant + nombre + rol), navegación por rol
│   └── ui/         # Tabla, modales, confirmaciones, toasts, formularios, badges, estados vacíos/carga/error
├── features/       # Pantallas por módulo: identity, employees, recruitment, timeleave,
│                   #   payroll, signup (registro + empresa en preparación), notifications
├── hooks/          # useAsync (carga con cancelación), useCursorList (cursor), usePolling (consulta periódica)
├── mocks/          # Backend simulado, SOLO desarrollo
├── pages/          # Login, Dashboard, 404
└── utils/          # Formato (fechas en hora de Lima, soles), validaciones, poller, reintentos ante 503,
                    #   descargas con URL prefirmada y validación de links
```

Los componentes nunca llaman a `fetch` directamente: usan los módulos de `src/api/`.

### Sesión y seguridad

- **Login:** se envían código de empresa (`tenantId`), email y contraseña a `POST /auth/login`. Toda llamada protegida lleva `Authorization: Bearer <token>`.
- **JWT:** solo se decodifica para leer `tenantId`, `role` y `exp`. La firma la verifica el backend.
- **Expiración:**
  - Un token vencido equivale a no tener sesión.
  - La sesión se cierra automáticamente al llegar a `exp`.
  - Antes de cada petición se comprueba que el token siga vigente.
- **401:** un `401` de cualquier API cierra la sesión y vuelve al login con un aviso. La excepción es el propio login, donde el 401 significa credenciales inválidas.
- **Errores:** se muestra el mensaje del backend, sea `{message}`, `{error}` o `{Message}`.
- **Almacenamiento:** el token se guarda en `sessionStorage`, así que se pierde al cerrar la pestaña.
- **Aislamiento entre tenants:**
  - El árbol autenticado se vuelve a montar al cambiar de tenant o de usuario, así que no sobrevive ningún dato de la sesión anterior.
  - Tras iniciar sesión con otra identidad no se reutiliza la URL de la sesión anterior.
  - El `tenantId` nunca se envía en body ni query: sale del JWT en el backend.
- **Rutas y menú:**
  - El menú muestra solo los módulos permitidos para el rol.
  - Entrar por URL a una ruta sin permiso redirige al inicio con un aviso; sin sesión, redirige al login.
  - Un `EMPLOYEE` solo puede abrir su propia ficha.
- **Alcance de los permisos del frontend:** son solo de experiencia de usuario. La autorización real la aplica cada backend.

### Permisos por rol (Issue #4)

| Módulo | ADMIN_RRHH | MANAGER | EMPLOYEE |
|---|---|---|---|
| Perfil (`GET /me`) | ✔ | ✔ | ✔ |
| Usuarios: listar, crear y editar nombre/rol/estado/contraseña | ✔ | — | — |
| Empleados: lista con búsqueda, filtros y paginación | ✔ | ✔ (su equipo) | — |
| Ficha de empleado | ✔ | ✔ (su equipo) | solo la suya |
| Alta, edición y baja de empleados | ✔ | — | — |
| Departamentos y puestos: ver / crear | ✔ / ✔ | ✔ / — | ✔ / — |
| Vacantes: ver / crear y editar | ✔ / ✔ | ✔ / — | ✔ / — |
| Postulaciones, CV y cambio de etapa | ✔ | ✔ | — |
| Marcar asistencia, mi asistencia, solicitudes y saldo | ✔ | ✔ | ✔ |
| Asistencia de otro empleado y bandeja de aprobación | ✔ | ✔ | — |
| **Planillas** (corridas, avance, reintento, boletas de todos) | ✔ | — | — |
| **Mis boletas** y descarga de la propia boleta | ✔ | ✔ | ✔ |
| **Eliminar** usuarios, vacantes y postulaciones | ✔ | — | — |
| **Notificaciones** propias (si la API está configurada) | ✔ | ✔ | ✔ |

## Funcionalidades del Issue #15

### Planillas (`/payroll`, solo ADMIN_RRHH)

- **Lista** paginada (`GET /payroll-runs?limit=&offset=`): periodo, estado, empleados procesados, bruto, neto, creador y fechas. Estados con color: `PENDING` (en cola), `PROCESSING`, `COMPLETED` y `FAILED`.
- **Nueva corrida:** selector de mes con `max` en el mes actual. Los meses futuros se bloquean calculando el mes en hora de Lima, igual que `payroll/src/schemas.py`. `POST /payroll-runs {period}` responde **202**: la corrida se muestra como aceptada (en cola), no como terminada.
- **Seguimiento automático:** mientras una corrida esté en `PENDING` o `PROCESSING` se consulta `GET /payroll-runs/{runId}` cada 5 s.
  - Se muestran los empleados procesados, sin inventar porcentaje: el backend no expone el total esperado.
  - La siguiente consulta se programa recién cuando termina la anterior, así que nunca se superponen.
  - El polling se detiene en `COMPLETED`/`FAILED` y se limpia al salir de la pantalla o cambiar de corrida.
- **Reintentar** (corridas `FAILED`): vuelve a llamar `POST /payroll-runs` con el mismo periodo. Hay protección contra doble envío y se muestra el mensaje del **409**.
- **Detalle** (`/payroll/:runId`): totales, datos de la corrida y boletas (`GET /payroll-runs/{runId}/payslips?limit=&offset=&q=`) con búsqueda por nombre o email: salario base, días de licencia no remunerada, bruto, descuento de pensión, descuento de licencias y neto.
- **Montos:** siempre `S/ 1,234.50` (2 decimales, separador de miles), sin depender del ICU del navegador.

### Mis boletas (`/payslips`, todos los roles)

- `GET /payslips/me?limit=&offset=` con periodo, bruto, descuentos (pensión + licencias) y neto, paginación y estados de carga, vacío y error.
- **Descarga:** `GET /payslips/{payslipId}/document-url` se pide **en cada clic** (la URL dura 5 min) y el `downloadUrl` se abre tal cual, sin `Authorization`. Si falla o venció, se muestra el error y se explica que basta con volver a pulsar «Descargar».

### Eliminar registros (solo ADMIN_RRHH)

| Dónde | Endpoint | Cuándo se oculta el botón |
|---|---|---|
| Detalle de vacante | `DELETE /jobs/{jobId}` | MANAGER y EMPLOYEE |
| Postulaciones de la vacante | `DELETE /jobs/{jobId}/applications/{applicationId}` | Etapa `HIRED`, MANAGER y EMPLOYEE |
| Usuarios y roles | `DELETE /users/{email}` | El propio usuario autenticado |

- Siempre con modal de confirmación; los botones se deshabilitan durante la petición.
- El `204` se interpreta sin parsear JSON. El registro se quita de la lista sin recargar, y los contadores del pipeline se recalculan.
- Los errores 400/403/404/409 muestran el mensaje real del backend dentro del modal: vacante con postulaciones, postulación contratada, usuario vinculado a un empleado y autoeliminación.

### Registro de empresas (`/signup`, público)

- Enlace «Registrar mi empresa» en el login.
- Formulario con validación por campo: nombre de empresa, correo, contraseña (≥ 8) y confirmación.
- `POST /signup` **nunca** se reintenta ni se envía dos veces.
- La respuesta (`tenantId`, `token`, `user`) se guarda con el mismo `sessionStore` del login.
- La pantalla de bienvenida muestra el **código de empresa**, explica que se usa para iniciar sesión, permite copiarlo y lo mantiene visible hasta pulsar «Entrar al sistema».
- **Empresa en preparación** (`/setup`):
  - Verifica employees (`GET /departments`) y payroll (`GET /payslips/me?limit=1`).
  - Ante un **503** muestra el mensaje del backend y reintenta cada **3 s**, como máximo **5 veces**, solo con esas consultas GET.
  - Al desmontar se cancelan las esperas.
  - Si se agotan los reintentos ofrece «Intentar de nuevo» o «Entrar de todas formas».
- Planillas y Mis boletas usan el mismo reintento ante 503 al cargar sus listas.

### Notificaciones (opcional)

- Solo con `VITE_NOTIFICATIONS_API_URL` definida. Si está vacía, el componente no se monta: ni campana ni peticiones.
- Campana en el encabezado con el contador (`GET /notifications/me/unread-count`), actualizado cada 60 s.
- Panel con paginación por cursor (`GET /notifications/me?limit=&cursor=`) y diferencia visual entre leídas y no leídas.
- Al pulsar una se marca como leída (`PATCH /notifications/{id}/read`) y se navega a su `link` **solo si es una ruta interna o del mismo origen**. Los enlaces externos se bloquean. `PAYSLIP_READY` lleva a Mis boletas.
- «Marcar todas como leídas» (`POST /notifications/read-all`). Contador y listado se actualizan sin recargar.
- **Aislamiento de fallos:** un error o un `401` de Notifications no cierra la sesión ni afecta al resto de la app, y un error de render en la campana solo la oculta.

## Pruebas

```bash
npm test         # 96 pruebas (28 del Issue #4 + 68 del Issue #15)
npm run build    # chequeo de TypeScript + build de producción
```

Cubren:

- La decodificación y expiración del JWT.
- La matriz de permisos.
- El cliente HTTP: URL desde el entorno, Bearer, 401 → logout, mensajes `{error}`/`{message}`, errores de red, variable faltante y PUT a S3 sin `Authorization`.
- Las transiciones de etapa, el cálculo de días hábiles, la zona horaria de Lima y las validaciones.
- **Issue #15** (`src/utils/issue15.test.ts`, `src/api/issue15.test.ts`, `src/auth/issue15.test.tsx`, `src/features/notifications/notificationState.test.ts`):
  - Formato `S/ 1,234.50`, mes actual en Lima y bloqueo de meses futuros.
  - Corrida `PENDING → PROCESSING → COMPLETED` con polling cada 5 s; `FAILED` y reintento con el mismo periodo; 409 con su mensaje.
  - Poller sin solapamiento y con limpieza al desmontar.
  - Descarga con URL pedida al hacer clic y nueva en cada clic.
  - `DELETE` con 204 sin cuerpo y conflictos 400/403/404/409.
  - Validaciones del registro; `POST /signup` público y sin reintentos.
  - 503 cada 3 s con máximo 5 reintentos y cancelación.
  - Permisos, menú y rutas protegidas por rol (render con `react-dom/server`).
  - Contador y listado de notificaciones; con `VITE_NOTIFICATIONS_API_URL` vacía no hay campana ni peticiones; links externos bloqueados; un 401 de Notifications no cierra la sesión.
  - Aislamiento entre tenants: token de la sesión vigente y clave del árbol por tenant y usuario.

Todas usan `fetch` simulado con `vi.fn()`: **no** llaman a AWS.

Los flujos principales se verificaron en el navegador con el modo demo:

- Login con validaciones y error de credenciales.
- Dashboard por rol.
- Alta y baja de empleado, búsqueda y filtros.
- Cambio de etapa y subida de CV.
- Marcación de entrada y salida.
- Solicitud y aprobación de vacaciones.
- Redirección por permisos.
- Cambio de tenant y diseño en móvil (375 px).
- Issue #15 (con el modo demo, no contra AWS):
  - Registro de empresa con validaciones, código de empresa y preparación con 503.
  - Planillas: crear, ver el avance hasta `COMPLETED`, 409, reintento de una corrida fallida, boletas con búsqueda y descarga.
  - Mis boletas en móvil.
  - Borrado de usuario (409 y 204), de postulaciones (contadores) y de vacante (409 y 204).
  - Notificaciones.
  - Rutas y menú de ADMIN_RRHH, MANAGER y EMPLOYEE.

## Integraciones pendientes de comprobar contra un backend real

No se tuvo acceso a URLs desplegadas, así que **ninguna integración se probó contra AWS**. Todas se
implementaron leyendo los handlers y `serverless.yml` de `services/*` en `main`.

| Servicio | Estado | Qué falta comprobar |
|---|---|---|
| identity | Contrato leído (handlers y `serverless.yml`), incluido `DELETE /users/{email}` | Login real, CORS del API Gateway, `DELETE` real |
| employees | Contrato leído (handlers, schemas y `serverless.yml`) | Respuestas reales de PostgreSQL (formato de `salary` y fechas) |
| recruitment | Contrato leído (handlers y `serverless.yml`, ya en `main`); las rutas coinciden con las usadas | PUT a S3 (CORS del bucket), `DELETE` reales |
| time & leave | Contrato leído (handlers y `serverless.yml`, ya en `main`); las rutas coinciden | Respuestas reales |
| payroll | Contrato leído (`payroll_runs.py`, `payslips.py`, `schemas.py`, `repository.py`, `serverless.yml`) | Corrida real por lotes, descarga desde S3, formato real de los NUMERIC |
| identity `POST /signup` | **No existe en `main`** (solo `POST /tenants` con `x-platform-key`). Cliente según el Issue #15 | Todo, cuando exista el endpoint |
| notifications | Handlers leídos (`notifications.py`, `repository.py`, `messages.py`, PR #16). **Aún no tiene `serverless.yml`**: las rutas HTTP se tomaron del Issue #15 | Rutas reales al desplegarse, CORS y respuesta real |

### Contratos con contradicciones o sin definir

1. **Formato de error.**
   - El Issue indica `{message}`, pero `common.http` devuelve `{error}`. API Gateway, en cambio, responde `{message}` (authorizer) o `{Message}`.
   - El frontend acepta los tres. Convendría unificarlo.
2. **Rutas de recruitment y time & leave.**
   - En el Issue #4 se asumieron las rutas del Issue. Su `serverless.yml` ya está en `main` y las rutas coinciden.
   - Ejemplo: `/jobs/{jobId}/applications/{applicationId}/cv-upload-url`, `/cv-url` y `/stage`; también `/leave-requests/{requestId}/approve|reject|cancel`.
3. **Filtro `GET /jobs?status=`.**
   - El backend pagina primero y filtra después, así que una página puede venir incompleta o vacía aunque exista `nextCursor`.
   - La UI ofrece "Cargar más" y lo explica en el estado vacío.
4. **Ficha propia del EMPLOYEE.**
   - Requiere que el usuario tenga `employeeId`, que identity rellena al consumir `EmployeeCreated`.
   - Si no está vinculado, se muestra un estado vacío explicativo.
5. **Bandeja de aprobación.**
   - `GET /leave-requests?status=PENDING` devuelve todas las pendientes del tenant, no solo las del equipo del manager.
   - Las solicitudes solo traen `email`, no el nombre.
   - El frontend no puede filtrar por equipo sin otro endpoint.
6. **Departamento de una vacante.** Recruitment solo guarda `departmentId`; el nombre se obtiene de employees (`GET /departments`).
7. **Selector de jefe directo.** `GET /employees` admite `limit` ≤ 100, así que el selector muestra los primeros 100 empleados activos.
8. **CV.**
   - El backend no limita el tamaño; el frontend aplica 10 MB y solo PDF.
   - El bucket S3 debe permitir CORS `PUT` con `Content-Type: application/pdf` desde el dominio del frontend.
   - Las URLs prefirmadas vencen a los 300 s.
9. **Zona horaria.** Las marcaciones y el "hoy" se calculan en `America/Lima`, igual que en los backends.
10. **Campo `employeeId` de `PATCH /users/{email}`.** El backend lo acepta, pero no se expone en la UI porque no figura en el Issue.

### Discrepancias del Issue #15 con el código de `main`

1. **`POST /payroll-runs` sobre un periodo existente.**
   - El issue indica 409 si el periodo ya tiene corrida. El backend responde **409 solo si está en `PROCESSING` o `COMPLETED`**.
   - Si está en `PENDING` vuelve a responder 202 con la misma corrida, y si está en `FAILED` la reinicia (202).
   - El frontend trata los tres casos.
2. **Totales de la corrida.** `totalGross` y `totalNet` valen 0 hasta `COMPLETED` (se calculan en `complete_run`). La UI lo indica.
3. **Avance.** La corrida solo trae `processed`; no hay total esperado, así que se muestra el número procesado y una barra indeterminada, sin porcentaje.
4. **`GET /payslips/me`** no incluye `fullName`; solo lo trae la lista de boletas de una corrida (JOIN con `payroll_employees`). Ambas traen además `runId`, `employeeId` y `createdAt`.
5. **Montos.** Los `NUMERIC` llegan como número JSON (`common.http` convierte `Decimal` a int/float). El formato a 2 decimales lo hace el frontend.
6. **Mes futuro.** El backend compara con la fecha de Lima (`LIMA_TIME`, UTC-5); el frontend usa la misma zona.
7. **Postulación contratada.** El campo es `stage` (no `status`); el botón se oculta con `stage === 'HIRED'`.
8. **Registro de empresas.**
   - `POST /signup` y la respuesta `{tenantId, token, user}` se tomaron del issue.
   - Ningún handler de employees o payroll devuelve hoy 503 «La empresa se está configurando»; el reintento está listo para cuando exista.
   - Se desconoce cómo generará el backend el `tenantId`.
9. **Notificaciones** (PR #16, fusionado durante este issue).
   - El contador responde `{unread}` (no `{count}`) y `read-all` responde `{updated}`. El cliente usa `unread` y, por robustez, también acepta `{count}`.
   - `GET /notifications/me` admite además `?unread=true`.
   - Las notificaciones `PAYSLIP_READY` traen `link: "/payroll"`, una pantalla solo para ADMIN_RRHH. Como avisan de la boleta propia, el frontend las lleva a `/payslips` (Mis boletas) para todos los roles. Convendría cambiar el link en `messages.py`.
   - El servicio no tiene `serverless.yml`: las rutas `/notifications/me`, `/notifications/me/unread-count`, `/notifications/{id}/read` y `/notifications/read-all` siguen el Issue #15.
10. **README raíz.** La sección de Amplify lista solo las 4 variables anteriores; falta agregar `VITE_PAYROLL_API_URL` y `VITE_NOTIFICATIONS_API_URL`. No se modificó porque este issue se limita a `frontend/`.
