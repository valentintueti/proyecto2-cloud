# TalentCloud HCM — Frontend

Frontend del SaaS HCM multi-tenant (Issue #4). Consume las APIs de **identity**, **employees**,
**recruitment** y **time & leave**.

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

- **Formato:** cada valor es la URL base del API Gateway incluyendo el stage, por ejemplo `https://xxxx.execute-api.us-east-1.amazonaws.com/dev`. El `/` final es opcional.
- **Si falta una variable:** la pantalla de login lo avisa, y las llamadas a ese servicio muestran un error claro sin hacer la petición.

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

## Arquitectura

```
src/
├── api/            # Capa HTTP: un módulo por microservicio + tipos de respuestas
│   ├── http.ts     #   cliente común: base URL, Bearer, 401 → logout, errores, PUT a S3
│   ├── identity.ts · employees.ts · recruitment.ts · timeLeave.ts
│   └── types.ts    #   tipos de cada API (usuario, empleado, vacante, postulación, solicitud…)
├── auth/           # Sesión (JWT), permisos por rol y guards de rutas
├── components/
│   ├── layout/     # Sidebar, header (tenant + nombre + rol), navegación por rol
│   └── ui/         # Tabla, modales, confirmaciones, toasts, formularios, badges, estados vacíos/carga/error
├── features/       # Pantallas por módulo: identity, employees, recruitment, timeleave
├── hooks/          # useAsync (carga con cancelación), useCursorList (paginación por cursor)
├── mocks/          # Backend simulado, SOLO desarrollo
├── pages/          # Login, Dashboard, 404
└── utils/          # Formato de fechas (hora de Lima), validaciones
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

## Pruebas

```bash
npm test         # 28 pruebas
npm run build    # chequeo de TypeScript + build de producción
```

Cubren:

- La decodificación y expiración del JWT.
- La matriz de permisos.
- El cliente HTTP: URL desde el entorno, Bearer, 401 → logout, mensajes `{error}`/`{message}`, errores de red, variable faltante y PUT a S3 sin `Authorization`.
- Las transiciones de etapa, el cálculo de días hábiles, la zona horaria de Lima y las validaciones.

Los flujos principales se verificaron en el navegador con el modo demo:

- Login con validaciones y error de credenciales.
- Dashboard por rol.
- Alta y baja de empleado, búsqueda y filtros.
- Cambio de etapa y subida de CV.
- Marcación de entrada y salida.
- Solicitud y aprobación de vacaciones.
- Redirección por permisos.
- Cambio de tenant y diseño en móvil (375 px).

## Integraciones pendientes de comprobar contra un backend real

Los backends no estaban desplegados durante el desarrollo, así que **ninguna integración se probó contra
AWS**. Todas se implementaron leyendo los handlers de `services/*` en `main`.

| Servicio | Estado | Qué falta comprobar |
|---|---|---|
| identity | Contrato leído de `services/identity` (handlers y `serverless.yml`) | Login real, CORS del API Gateway |
| employees | Contrato leído de `services/employees` (handlers, schemas y `serverless.yml`) | Respuestas reales de PostgreSQL (formato de `salary` y fechas) |
| recruitment | Contrato leído de los handlers; **no hay `serverless.yml`** | Rutas exactas (se tomaron del Issue #4), PUT a S3 (CORS del bucket) |
| time & leave | Contrato leído de los handlers; **no hay `serverless.yml`** | Rutas exactas (se tomaron del Issue #4) |

### Contratos con contradicciones o sin definir

1. **Formato de error.**
   - El Issue indica `{message}`, pero `common.http` devuelve `{error}`. API Gateway, en cambio, responde `{message}` (authorizer) o `{Message}`.
   - El frontend acepta los tres. Convendría unificarlo.
2. **Rutas de recruitment y time & leave.**
   - Estos servicios no tienen `serverless.yml` en `main`, así que se asumieron las rutas del Issue.
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
