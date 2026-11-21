/**
 * ⚠️ BACKEND SIMULADO — SOLO DESARROLLO.
 *
 * Se carga con import dinámico desde api/http.ts únicamente cuando USE_MOCKS es true
 * (`npm run dev` + VITE_USE_MOCKS=true). En `npm run build` USE_MOCKS es false en tiempo
 * de compilación y este módulo no se incluye en el bundle: producción nunca simula respuestas.
 *
 * Replica las reglas de los handlers reales (roles, validaciones, transiciones, errores {error})
 * para poder probar la interfaz sin desplegar los microservicios.
 */
import type { ServiceName } from '../config/env';
import type { Employee, LeaveRequest, Role, Stage } from '../api/types';
import { addDays, businessDays, todayISO } from '../utils/format';
import { createDatabase, uuid, type MockUser, type TenantDb } from './data';

const db: Record<string, TenantDb> = createDatabase();
const LATENCY_MS = 250;
const TOKEN_TTL_SECONDS = 8 * 3600;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const bad = (msg: string) => new HttpError(400, msg);
const forbidden = (msg = 'Acceso denegado') => new HttpError(403, msg);
const notFound = (msg = 'No encontrado') => new HttpError(404, msg);
const conflict = (msg: string) => new HttpError(409, msg);

interface Ctx {
  tenantId: string;
  userId: string;
  role: Role;
}

interface Req {
  method: string;
  path: string;
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  ctx: Ctx | null;
}

type Handler = (req: Req) => { status?: number; body?: unknown };

// ── Token simulado (sin firma real: el frontend nunca verifica firmas) ──────────
function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(sub: string, tenantId: string, role: Role): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub, tenantId, role, iat, exp: iat + TOKEN_TTL_SECONDS }));
  return `${header}.${payload}.mock-signature`;
}

function authorize(header: string | null): Ctx | null {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = header.slice(7).split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(decodeURIComponent(escape(json))) as Ctx & { sub: string; exp: number };
    if (claims.exp * 1000 < Date.now() || !db[claims.tenantId]) return null;
    return { tenantId: claims.tenantId, userId: claims.sub, role: claims.role };
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES: Role[] = ['ADMIN_RRHH', 'MANAGER', 'EMPLOYEE'];

function tenant(req: Req): TenantDb {
  return db[req.ctx!.tenantId];
}

function requireRole(req: Req, ...roles: Role[]): Ctx {
  const ctx = req.ctx!;
  if (!roles.includes(ctx.role)) throw forbidden(`El rol '${ctx.role}' no puede realizar esta acción`);
  return ctx;
}

function requireFields(body: Record<string, unknown>, ...fields: string[]) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw bad(`Faltan campos: ${missing.join(', ')}`);
}

function normEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw bad('email inválido');
  return email;
}

function limitOf(req: Req, def = 20): number {
  const raw = req.query.get('limit');
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw bad('limit debe ser un entero');
  if (n < 1 || n > 100) throw bad('limit debe estar entre 1 y 100');
  return n;
}

function cursorPage<T>(items: T[], req: Req, def = 20) {
  const limit = limitOf(req, def);
  const start = req.query.get('cursor') ? Number(atob(req.query.get('cursor')!)) : 0;
  if (!Number.isInteger(start) || start < 0) throw bad('Cursor de paginación inválido');
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? btoa(String(start + limit)) : null;
  return { items: page, nextCursor: next };
}

const publicUser = ({ password: _password, ...user }: MockUser) => user;

function money(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || Number.isNaN(n)) throw bad(`${field} debe ser un número`);
  if (n < 0 || n > 99_999_999.99) throw bad(`${field} debe estar entre 0 y 99999999.99`);
  return Math.round(n * 100) / 100;
}

function isoDate(value: unknown, field: string): string {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${field} debe tener formato YYYY-MM-DD`);
  return s;
}

// ── Identity ─────────────────────────────────────────────────────────────────
const identityRoutes: [string, RegExp, Handler][] = [
  [
    'POST',
    /^\/auth\/login$/,
    ({ body }) => {
      requireFields(body, 'tenantId', 'email', 'password');
      const t = db[String(body.tenantId).trim().toLowerCase()];
      const user = t?.users.find((u) => u.email === String(body.email).trim().toLowerCase());
      if (!t || !user || !user.password || user.password !== body.password || user.status !== 'ACTIVE') {
        throw new HttpError(401, 'Credenciales inválidas');
      }
      const tenantId = String(body.tenantId).trim().toLowerCase();
      return { body: { token: makeToken(user.userId, tenantId, user.role), tokenType: 'Bearer', user: publicUser(user) } };
    },
  ],
  [
    'GET',
    /^\/me$/,
    (req) => {
      const user = tenant(req).users.find((u) => u.userId === req.ctx!.userId);
      if (!user) throw notFound('Usuario no encontrado');
      return { body: publicUser(user) };
    },
  ],
  [
    'GET',
    /^\/users$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const users = [...tenant(req).users].sort((a, b) => a.email.localeCompare(b.email)).map(publicUser);
      return { body: cursorPage(users, req) };
    },
  ],
  [
    'POST',
    /^\/users$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const { body } = req;
      requireFields(body, 'email', 'name', 'role', 'password');
      const email = normEmail(body.email);
      if (!ROLES.includes(body.role as Role)) throw bad(`role debe ser uno de ${JSON.stringify(ROLES)}`);
      if (String(body.password).length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
      const name = String(body.name).trim();
      if (!name || name.length > 120) throw bad('name debe tener entre 1 y 120 caracteres');
      if (tenant(req).users.some((u) => u.email === email)) throw conflict('El recurso ya existe');
      const user: MockUser = {
        userId: email,
        email,
        name,
        role: body.role as Role,
        status: 'ACTIVE',
        createdAt: nowIso(),
        password: String(body.password),
      };
      tenant(req).users.push(user);
      return { status: 201, body: publicUser(user) };
    },
  ],
  [
    'PATCH',
    /^\/users\/([^/]+)$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH');
      const email = normEmail(decodeURIComponent(req.params[0]));
      const allowed = ['name', 'role', 'status', 'password', 'employeeId'];
      const unknown = Object.keys(req.body).filter((k) => !allowed.includes(k));
      if (unknown.length) throw bad(`Campos no permitidos: ${unknown.sort().join(', ')}`);
      if (Object.keys(req.body).length === 0) throw bad('No hay campos para actualizar');
      const { name, role, status, password } = req.body as Record<string, string | undefined>;
      if (role !== undefined && !ROLES.includes(role as Role)) throw bad('role inválido');
      if (status !== undefined && !['ACTIVE', 'DISABLED'].includes(status)) throw bad('status debe ser ACTIVE o DISABLED');
      if (password !== undefined && password.length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
      if (email === ctx.userId && ((role && role !== 'ADMIN_RRHH') || (status && status !== 'ACTIVE'))) {
        throw bad('No puedes quitarte tu propio rol ni desactivarte');
      }
      const user = tenant(req).users.find((u) => u.email === email);
      if (!user) throw notFound('Usuario no encontrado');
      if (name !== undefined) user.name = name.trim();
      if (role) user.role = role as Role;
      if (status) user.status = status as MockUser['status'];
      if (password) {
        user.password = password;
      }
      user.updatedAt = nowIso();
      return { body: publicUser(user) };
    },
  ],
];

// ── Employees ────────────────────────────────────────────────────────────────
const EMP_FIELDS = ['firstName', 'lastName', 'email', 'documentNumber', 'phone', 'hireDate', 'salary', 'departmentId', 'positionId', 'managerId'];

function applyEmployeeFields(t: TenantDb, target: Partial<Employee>, body: Record<string, unknown>) {
  for (const [key, value] of Object.entries(body)) {
    switch (key) {
      case 'firstName':
      case 'lastName': {
        const text = String(value ?? '').trim();
        if (!text) throw bad(`${key} es obligatorio`);
        if (text.length > 80) throw bad(`${key} admite máximo 80 caracteres`);
        target[key] = text;
        break;
      }
      case 'email':
        target.email = normEmail(value);
        break;
      case 'documentNumber': {
        const text = String(value ?? '').trim();
        if (!text) throw bad('documentNumber es obligatorio');
        if (text.length > 20) throw bad('documentNumber admite máximo 20 caracteres');
        target.documentNumber = text;
        break;
      }
      case 'phone':
        target.phone = value === null ? null : String(value).trim() || null;
        break;
      case 'hireDate':
        target.hireDate = isoDate(value, 'hireDate');
        break;
      case 'salary':
        target.salary = money(value, 'salary');
        break;
      case 'departmentId': {
        if (value === null) {
          target.departmentId = null;
          target.departmentName = null;
          break;
        }
        const dep = t.departments.find((d) => d.id === value);
        if (!dep) throw bad('departmentId no existe');
        target.departmentId = dep.id;
        target.departmentName = dep.name;
        break;
      }
      case 'positionId': {
        if (value === null) {
          target.positionId = null;
          target.positionTitle = null;
          break;
        }
        const pos = t.positions.find((p) => p.id === value);
        if (!pos) throw bad('positionId no existe');
        target.positionId = pos.id;
        target.positionTitle = pos.title;
        break;
      }
      case 'managerId': {
        if (value === null) {
          target.managerId = null;
          break;
        }
        if (!t.employees.some((e) => e.id === value)) throw bad('managerId no existe');
        target.managerId = String(value);
        break;
      }
    }
  }
}

const employeesRoutes: [string, RegExp, Handler][] = [
  [
    'GET',
    /^\/employees$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH', 'MANAGER');
      const t = tenant(req);
      const limit = limitOf(req);
      const offset = Number(req.query.get('offset') ?? 0);
      if (!Number.isInteger(offset) || offset < 0) throw bad('offset debe ser mayor o igual a 0');
      const status = req.query.get('status')?.toUpperCase();
      if (status && !['ACTIVE', 'TERMINATED'].includes(status)) throw bad("status debe ser uno de ['ACTIVE', 'TERMINATED']");
      const dep = req.query.get('departmentId');
      const q = (req.query.get('q') ?? '').trim().toLowerCase();
      let list = t.employees;
      if (ctx.role === 'MANAGER') {
        const me = t.employees.find((e) => e.email === ctx.userId);
        if (!me) return { body: { items: [], total: 0, limit, offset } };
        list = list.filter((e) => e.managerId === me.id);
      }
      list = list
        .filter((e) => !status || e.status === status)
        .filter((e) => !dep || e.departmentId === dep)
        .filter((e) => !q || `${e.firstName} ${e.lastName} ${e.email}`.toLowerCase().includes(q))
        .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
      return { body: { items: list.slice(offset, offset + limit), total: list.length, limit, offset } };
    },
  ],
  [
    'GET',
    /^\/employees\/([^/]+)$/,
    (req) => {
      const ctx = req.ctx!;
      const t = tenant(req);
      const emp = t.employees.find((e) => e.id === req.params[0]);
      if (!emp) throw notFound('Empleado no encontrado');
      const me = t.employees.find((e) => e.email === ctx.userId);
      const canView =
        ctx.role === 'ADMIN_RRHH' || emp.email === ctx.userId || (ctx.role === 'MANAGER' && !!me && emp.managerId === me.id);
      if (!canView) throw forbidden('No puedes ver la ficha de este empleado');
      return { body: emp };
    },
  ],
  [
    'POST',
    /^\/employees$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const t = tenant(req);
      const unknown = Object.keys(req.body).filter((k) => !EMP_FIELDS.includes(k));
      if (unknown.length) throw bad(`Campos no permitidos: ${unknown.join(', ')}`);
      requireFields(req.body, 'firstName', 'lastName', 'email', 'documentNumber', 'hireDate', 'salary');
      const emp: Employee = {
        id: uuid(),
        firstName: '',
        lastName: '',
        email: '',
        documentNumber: '',
        phone: null,
        hireDate: '',
        terminationDate: null,
        status: 'ACTIVE',
        salary: 0,
        departmentId: null,
        departmentName: null,
        positionId: null,
        positionTitle: null,
        managerId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      applyEmployeeFields(t, emp, req.body);
      if (t.employees.some((e) => e.email === emp.email)) throw conflict('Ya existe un empleado con ese email');
      if (t.employees.some((e) => e.documentNumber === emp.documentNumber)) throw conflict('Ya existe un empleado con ese documento');
      t.employees.push(emp);
      return { status: 201, body: emp };
    },
  ],
  [
    'PATCH',
    /^\/employees\/([^/]+)$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const t = tenant(req);
      const blocked = Object.keys(req.body).filter((k) => ['email', 'status', 'terminationDate'].includes(k));
      if (blocked.length) throw bad(`No se puede modificar: ${blocked.join(', ')}. Para dar de baja usa /terminate`);
      if (!Object.keys(req.body).length) throw bad('No hay campos para actualizar');
      if (req.body.managerId === req.params[0]) throw bad('Un empleado no puede ser su propio jefe');
      const emp = t.employees.find((e) => e.id === req.params[0]);
      if (!emp) throw notFound('Empleado no encontrado');
      if (emp.status === 'TERMINATED') throw conflict('El empleado está dado de baja');
      const draft = { ...emp };
      applyEmployeeFields(t, draft, req.body);
      if (t.employees.some((e) => e.id !== emp.id && e.documentNumber === draft.documentNumber)) {
        throw conflict('Ya existe un empleado con ese documento');
      }
      Object.assign(emp, draft, { updatedAt: nowIso() });
      return { body: emp };
    },
  ],
  [
    'POST',
    /^\/employees\/([^/]+)\/terminate$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH');
      requireFields(req.body, 'terminationDate');
      const date = isoDate(req.body.terminationDate, 'terminationDate');
      const emp = tenant(req).employees.find((e) => e.id === req.params[0]);
      if (!emp) throw notFound('Empleado no encontrado');
      if (emp.status === 'TERMINATED') throw conflict('El empleado ya está dado de baja');
      if (emp.email === ctx.userId) throw bad('No puedes darte de baja a ti mismo');
      if (date < emp.hireDate) throw bad('terminationDate no puede ser anterior a hireDate');
      Object.assign(emp, { status: 'TERMINATED', terminationDate: date, updatedAt: nowIso() });
      const user = tenant(req).users.find((u) => u.email === emp.email);
      if (user) user.status = 'DISABLED'; // simula el consumidor EmployeeTerminated de identity
      return { body: emp };
    },
  ],
  ['GET', /^\/departments$/, (req) => ({ body: { items: [...tenant(req).departments].sort((a, b) => a.name.localeCompare(b.name)) } })],
  [
    'POST',
    /^\/departments$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const name = String(req.body.name ?? '').trim();
      if (!name) throw bad('name es obligatorio');
      if (name.length > 100) throw bad('name admite máximo 100 caracteres');
      if (tenant(req).departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw conflict('Ya existe un departamento con ese nombre');
      const dep = { id: uuid(), name, createdAt: nowIso() };
      tenant(req).departments.push(dep);
      return { status: 201, body: dep };
    },
  ],
  [
    'GET',
    /^\/positions$/,
    (req) => {
      const dep = req.query.get('departmentId');
      const items = tenant(req)
        .positions.filter((p) => !dep || p.departmentId === dep)
        .sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.title.localeCompare(b.title));
      return { body: { items } };
    },
  ],
  [
    'POST',
    /^\/positions$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const t = tenant(req);
      const title = String(req.body.title ?? '').trim();
      if (!title) throw bad('title es obligatorio');
      const dep = t.departments.find((d) => d.id === req.body.departmentId);
      if (!dep) throw bad('departmentId no es un UUID válido');
      const min = req.body.minSalary == null ? null : money(req.body.minSalary, 'minSalary');
      const max = req.body.maxSalary == null ? null : money(req.body.maxSalary, 'maxSalary');
      if (min !== null && max !== null && min > max) throw bad('minSalary no puede ser mayor que maxSalary');
      if (t.positions.some((p) => p.departmentId === dep.id && p.title.toLowerCase() === title.toLowerCase())) {
        throw conflict('Ya existe ese puesto en el departamento');
      }
      const pos = { id: uuid(), title, departmentId: dep.id, departmentName: dep.name, minSalary: min, maxSalary: max };
      t.positions.push(pos);
      return { status: 201, body: pos };
    },
  ],
];

// ── Recruitment ──────────────────────────────────────────────────────────────
const NEXT: Partial<Record<Stage, Stage>> = { APPLIED: 'SCREENING', SCREENING: 'INTERVIEW', INTERVIEW: 'OFFER', OFFER: 'HIRED' };
const RECRUITERS: Role[] = ['ADMIN_RRHH', 'MANAGER'];
const cvFiles = new Map<string, Blob>();

function findApp(req: Req) {
  const app = tenant(req).applications.find((a) => a.jobId === req.params[0] && a.applicationId === req.params[1]);
  if (!app) throw notFound('Postulación no encontrada');
  return app;
}

function jobFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'title' in body) {
    const title = String(body.title ?? '').trim();
    if (!title) throw bad('title es obligatorio');
    if (title.length > 150) throw bad('title no puede superar 150 caracteres');
    out.title = title;
  }
  if ('description' in body) out.description = String(body.description ?? '').trim();
  if ('location' in body) out.location = String(body.location ?? '').trim();
  if ('openings' in body || !partial) {
    const openings = body.openings ?? 1;
    if (typeof openings !== 'number' || !Number.isInteger(openings) || openings < 1 || openings > 1000) {
      throw bad('openings debe estar entre 1 y 1000');
    }
    out.openings = openings;
  }
  if ('status' in body || !partial) {
    const status = body.status ?? 'OPEN';
    if (!['OPEN', 'CLOSED'].includes(String(status))) throw bad("status debe ser uno de ['OPEN', 'CLOSED']");
    out.status = status;
  }
  if ('departmentId' in body) out.departmentId = body.departmentId || null;
  return out;
}

const recruitmentRoutes: [string, RegExp, Handler][] = [
  [
    'GET',
    /^\/jobs$/,
    (req) => {
      const status = req.query.get('status');
      if (status && !['OPEN', 'CLOSED'].includes(status)) throw bad("status debe ser uno de ['OPEN', 'CLOSED']");
      const sorted = [...tenant(req).jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      // Igual que el backend: pagina primero y filtra cada página por estado.
      const page = cursorPage(sorted, req);
      return { body: { items: page.items.filter((j) => !status || j.status === status), nextCursor: page.nextCursor } };
    },
  ],
  [
    'POST',
    /^\/jobs$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH');
      const fields = jobFields(req.body, false);
      const job = {
        jobId: uuid(),
        description: '',
        location: '',
        ...fields,
        createdBy: ctx.userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      } as TenantDb['jobs'][number];
      tenant(req).jobs.push(job);
      return { status: 201, body: job };
    },
  ],
  [
    'GET',
    /^\/jobs\/([^/]+)$/,
    (req) => {
      const job = tenant(req).jobs.find((j) => j.jobId === req.params[0]);
      if (!job) throw notFound('Vacante no encontrada');
      return { body: job };
    },
  ],
  [
    'PATCH',
    /^\/jobs\/([^/]+)$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const fields = jobFields(req.body, true);
      if (!Object.keys(fields).length) throw bad('No hay campos para actualizar');
      const job = tenant(req).jobs.find((j) => j.jobId === req.params[0]);
      if (!job) throw notFound('Vacante no encontrada');
      Object.assign(job, fields, { updatedAt: nowIso() });
      return { body: job };
    },
  ],
  [
    'GET',
    /^\/jobs\/([^/]+)\/applications$/,
    (req) => {
      requireRole(req, ...RECRUITERS);
      if (!tenant(req).jobs.some((j) => j.jobId === req.params[0])) throw notFound('Vacante no encontrada');
      const apps = tenant(req).applications.filter((a) => a.jobId === req.params[0]);
      return { body: cursorPage(apps, req) };
    },
  ],
  [
    'POST',
    /^\/jobs\/([^/]+)\/applications$/,
    (req) => {
      requireRole(req, ...RECRUITERS);
      const job = tenant(req).jobs.find((j) => j.jobId === req.params[0]);
      if (!job) throw notFound('Vacante no encontrada');
      if (job.status !== 'OPEN') throw bad('La vacante no está abierta');
      requireFields(req.body, 'firstName', 'lastName', 'email');
      const email = normEmail(req.body.email);
      if (tenant(req).applications.some((a) => a.jobId === job.jobId && a.email === email)) {
        throw conflict('Ese email ya postuló a esta vacante');
      }
      const phone = String(req.body.phone ?? '').trim();
      if (phone && !/^\+?[0-9 ()-]{6,20}$/.test(phone)) throw bad('phone inválido');
      const app = {
        applicationId: uuid(),
        jobId: job.jobId,
        firstName: String(req.body.firstName).trim(),
        lastName: String(req.body.lastName).trim(),
        email,
        phone,
        stage: 'APPLIED' as Stage,
        cvKey: null,
        notes: String(req.body.notes ?? '').trim(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      tenant(req).applications.push(app);
      return { status: 201, body: app };
    },
  ],
  [
    'POST',
    /^\/jobs\/([^/]+)\/applications\/([^/]+)\/cv-upload-url$/,
    (req) => {
      requireRole(req, ...RECRUITERS);
      requireFields(req.body, 'fileName', 'contentType');
      if (req.body.contentType !== 'application/pdf') throw bad('Solo se aceptan CVs en PDF (application/pdf)');
      const app = findApp(req);
      const key = `tenants/${req.ctx!.tenantId}/cvs/${app.applicationId}/${String(req.body.fileName).replace(/[^\w.-]/g, '_')}`;
      app.cvKey = key;
      app.updatedAt = nowIso();
      return { body: { uploadUrl: `mock://s3/${encodeURIComponent(key)}`, cvKey: key } };
    },
  ],
  [
    'GET',
    /^\/jobs\/([^/]+)\/applications\/([^/]+)\/cv-url$/,
    (req) => {
      requireRole(req, ...RECRUITERS);
      const app = findApp(req);
      if (!app.cvKey) throw notFound('La postulación no tiene CV');
      const file = cvFiles.get(app.cvKey);
      const url = file
        ? URL.createObjectURL(file)
        : URL.createObjectURL(new Blob([`CV simulado (${app.firstName} ${app.lastName}) — modo demo`], { type: 'text/plain' }));
      return { body: { downloadUrl: url } };
    },
  ],
  [
    'PATCH',
    /^\/jobs\/([^/]+)\/applications\/([^/]+)\/stage$/,
    (req) => {
      requireRole(req, ...RECRUITERS);
      const app = findApp(req);
      requireFields(req.body, 'stage');
      const target = req.body.stage as Stage;
      const valid = (target === 'REJECTED' && !['HIRED', 'REJECTED'].includes(app.stage)) || NEXT[app.stage] === target;
      if (!valid) throw bad(`Transición inválida: ${app.stage} -> ${target}`);
      if (target === 'HIRED') {
        const job = tenant(req).jobs.find((j) => j.jobId === app.jobId)!;
        if (job.status !== 'OPEN' || job.openings < 1) throw conflict('La vacante no tiene puestos disponibles');
        if (req.body.startDate) isoDate(req.body.startDate, 'startDate');
        job.openings -= 1;
        if (job.openings === 0) job.status = 'CLOSED';
        job.updatedAt = nowIso();
      }
      app.stage = target;
      if (typeof req.body.notes === 'string') app.notes = req.body.notes;
      app.updatedAt = nowIso();
      return { body: app };
    },
  ],
];

// ── Time & Leave ─────────────────────────────────────────────────────────────
function limaNowIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour').replace('24', '00')}:${get('minute')}:${get('second')}-05:00`;
}

function balanceOf(t: TenantDb, email: string, year: number) {
  let balance = t.balances.find((b) => b.email === email && b.year === year);
  if (!balance) {
    balance = { email, year, vacationDays: 30, usedDays: 0 };
    t.balances.push(balance);
  }
  return balance;
}

function range(req: Req): [string | null, string | null] {
  const from = req.query.get('from') ? isoDate(req.query.get('from'), 'from') : null;
  const to = req.query.get('to') ? isoDate(req.query.get('to'), 'to') : null;
  if (from && to && to < from) throw bad('to debe ser mayor o igual a from');
  return [from, to];
}

function attendanceFor(req: Req, email: string) {
  const [from, to] = range(req);
  const items = tenant(req)
    .attendance.filter((a) => a.email === email && (!from || a.date >= from) && (!to || a.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { body: { items } };
}

function decide(req: Req, status: LeaveRequest['status']) {
  const ctx = requireRole(req, ...RECRUITERS);
  const leave = tenant(req).leaves.find((l) => l.requestId === req.params[0]);
  if (!leave) throw notFound('Solicitud no encontrada');
  if (leave.email === ctx.userId) throw bad('No puedes decidir sobre tu propia solicitud');
  if (leave.status !== 'PENDING') throw conflict('La solicitud ya no está pendiente');
  if (status === 'APPROVED' && leave.type === 'VACATION') {
    const balance = balanceOf(tenant(req), leave.email, Number(leave.startDate.slice(0, 4)));
    if (leave.days > balance.vacationDays - balance.usedDays) throw conflict('Saldo de vacaciones insuficiente');
    balance.usedDays += leave.days;
  }
  Object.assign(leave, { status, decidedBy: ctx.userId, decidedAt: nowIso() });
  return { body: leave };
}

const timeLeaveRoutes: [string, RegExp, Handler][] = [
  [
    'POST',
    /^\/attendance\/check-in$/,
    (req) => {
      const now = limaNowIso();
      const date = now.slice(0, 10);
      const t = tenant(req);
      if (t.attendance.some((a) => a.email === req.ctx!.userId && a.date === date)) throw conflict('Ya marcaste tu entrada hoy');
      const record = { email: req.ctx!.userId, date, checkIn: now };
      t.attendance.push(record);
      return { status: 201, body: record };
    },
  ],
  [
    'POST',
    /^\/attendance\/check-out$/,
    (req) => {
      const now = limaNowIso();
      const record = tenant(req).attendance.find((a) => a.email === req.ctx!.userId && a.date === now.slice(0, 10));
      if (!record) throw bad('Primero debes marcar tu entrada');
      if (record.checkOut) throw conflict('Ya marcaste tu salida hoy');
      record.checkOut = now;
      record.workedMinutes = Math.max(0, Math.floor((Date.parse(now) - Date.parse(record.checkIn)) / 60000));
      return { body: record };
    },
  ],
  ['GET', /^\/attendance\/me$/, (req) => attendanceFor(req, req.ctx!.userId)],
  [
    'GET',
    /^\/attendance$/,
    (req) => {
      requireRole(req, ...RECRUITERS);
      const email = req.query.get('email');
      if (!email) throw bad('Falta el parámetro email');
      return attendanceFor(req, normEmail(email));
    },
  ],
  [
    'POST',
    /^\/leave-requests$/,
    (req) => {
      const { body } = req;
      requireFields(body, 'type', 'startDate', 'endDate');
      if (!['VACATION', 'SICK', 'PERSONAL'].includes(String(body.type))) {
        throw bad("type debe ser uno de ['VACATION', 'SICK', 'PERSONAL']");
      }
      const start = isoDate(body.startDate, 'startDate');
      const end = isoDate(body.endDate, 'endDate');
      if (end < start) throw bad('endDate debe ser mayor o igual a startDate');
      if (end >= addDays(start, 366)) throw bad('El rango no puede superar un año');
      const days = businessDays(start, end);
      if (days === 0) throw bad('El rango no incluye días hábiles');
      const reason = String(body.reason ?? '').trim();
      if (reason.length > 500) throw bad('reason no puede superar 500 caracteres');
      const t = tenant(req);
      if (body.type === 'VACATION') {
        const balance = balanceOf(t, req.ctx!.userId, Number(start.slice(0, 4)));
        if (days > balance.vacationDays - balance.usedDays) throw conflict('Saldo de vacaciones insuficiente');
      }
      const leave: LeaveRequest = {
        requestId: uuid(),
        email: req.ctx!.userId,
        type: body.type as LeaveRequest['type'],
        startDate: start,
        endDate: end,
        days,
        reason,
        status: 'PENDING',
        createdAt: nowIso(),
      };
      t.leaves.push(leave);
      return { status: 201, body: leave };
    },
  ],
  [
    'GET',
    /^\/leave-requests\/me$/,
    (req) => {
      const items = tenant(req)
        .leaves.filter((l) => l.email === req.ctx!.userId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
      return { body: cursorPage(items, req) };
    },
  ],
  [
    'GET',
    /^\/leave-requests$/,
    (req) => {
      requireRole(req, ...RECRUITERS);
      const status = req.query.get('status') ?? 'PENDING';
      if (!['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) throw bad('status inválido');
      const items = tenant(req)
        .leaves.filter((l) => l.status === status)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      return { body: cursorPage(items, req) };
    },
  ],
  ['POST', /^\/leave-requests\/([^/]+)\/approve$/, (req) => decide(req, 'APPROVED')],
  ['POST', /^\/leave-requests\/([^/]+)\/reject$/, (req) => decide(req, 'REJECTED')],
  [
    'POST',
    /^\/leave-requests\/([^/]+)\/cancel$/,
    (req) => {
      const leave = tenant(req).leaves.find((l) => l.requestId === req.params[0]);
      if (!leave) throw notFound('Solicitud no encontrada');
      if (leave.email !== req.ctx!.userId) throw forbidden('Solo el dueño puede cancelar su solicitud');
      if (leave.status !== 'PENDING') throw conflict('Solo se pueden cancelar solicitudes pendientes');
      Object.assign(leave, { status: 'CANCELLED', decidedBy: req.ctx!.userId, decidedAt: nowIso() });
      return { body: leave };
    },
  ],
  [
    'GET',
    /^\/balances\/me$/,
    (req) => {
      const year = Number(todayISO().slice(0, 4));
      const b = tenant(req).balances.find((x) => x.email === req.ctx!.userId && x.year === year) ?? {
        email: req.ctx!.userId,
        year,
        vacationDays: 30,
        usedDays: 0,
      };
      return { body: { ...b, availableDays: b.vacationDays - b.usedDays } };
    },
  ],
];

// ── Issue #15: borrados (identity y recruitment) ────────────────────────────
identityRoutes.push([
  'DELETE',
  /^\/users\/([^/]+)$/,
  (req) => {
    const ctx = requireRole(req, 'ADMIN_RRHH');
    const email = normEmail(decodeURIComponent(req.params[0]));
    if (email === ctx.userId) throw bad('No puedes eliminar tu propio usuario');
    const users = tenant(req).users;
    const user = users.find((u) => u.email === email);
    if (!user) throw notFound('Usuario no encontrado');
    if (user.employeeId) throw conflict('Da de baja al empleado en lugar de borrar el usuario');
    users.splice(users.indexOf(user), 1);
    return { status: 204 };
  },
]);

recruitmentRoutes.push(
  [
    'DELETE',
    /^\/jobs\/([^/]+)$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const t = tenant(req);
      const job = t.jobs.find((j) => j.jobId === req.params[0]);
      if (!job) throw notFound('Vacante no encontrada');
      if (t.applications.some((a) => a.jobId === job.jobId)) throw conflict('Elimina o cierra primero sus postulaciones');
      t.jobs.splice(t.jobs.indexOf(job), 1);
      return { status: 204 };
    },
  ],
  [
    'DELETE',
    /^\/jobs\/([^/]+)\/applications\/([^/]+)$/,
    (req) => {
      requireRole(req, 'ADMIN_RRHH');
      const t = tenant(req);
      const app = t.applications.find((a) => a.jobId === req.params[0] && a.applicationId === req.params[1]);
      if (!app) throw notFound('Postulación no encontrada');
      if (app.stage === 'HIRED') throw conflict('No se puede eliminar una postulación contratada');
      t.applications.splice(t.applications.indexOf(app), 1);
      if (app.cvKey) cvFiles.delete(app.cvKey);
      return { status: 204 };
    },
  ],
);

// Datos extra para probar borrados: usuarios sin empleado y una vacante sin postulaciones.
for (const [tenantId, t] of Object.entries(db)) {
  const domain = t.users[0]?.email.split('@')[1] ?? `${tenantId}.com`;
  for (const [name, role] of [
    ['Reclutadora Externa', 'MANAGER'],
    ['Auditor Temporal', 'EMPLOYEE'],
  ] as [string, Role][]) {
    const email = `${name.split(' ')[0].toLowerCase()}@${domain}`;
    t.users.push({ userId: email, email, name, role, status: 'ACTIVE', createdAt: nowIso(), password: 'demo1234' });
  }
  t.jobs.push({
    jobId: uuid(),
    title: 'Practicante de Marketing (borrador)',
    description: 'Vacante sin postulaciones: se puede eliminar.',
    location: 'Remoto',
    openings: 1,
    status: 'CLOSED',
    departmentId: t.departments[0]?.id ?? null,
    createdBy: t.users[0]?.email ?? 'admin',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

// ── Issue #15: registro de empresas y "empresa en preparación" (503) ────────
const SETUP_MS = 7000; // employees y payroll responden 503 durante este tiempo tras el registro
const setupUntil = new Map<string, number>();

function slugTenant(companyName: string): string {
  const base =
    companyName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 24) || 'empresa';
  let id = base.length >= 2 ? base : `${base}co`;
  for (let n = 2; db[id]; n += 1) id = `${base.slice(0, 22)}_${n}`;
  return id;
}

identityRoutes.push([
  'POST',
  /^\/signup$/,
  ({ body }) => {
    requireFields(body, 'companyName', 'email', 'password');
    const companyName = String(body.companyName).trim();
    if (companyName.length < 2 || companyName.length > 100) throw bad('companyName debe tener entre 2 y 100 caracteres');
    const email = normEmail(body.email);
    if (String(body.password).length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
    const tenantId = slugTenant(companyName);
    const user: MockUser = {
      userId: email,
      email,
      name: 'Administrador',
      role: 'ADMIN_RRHH',
      status: 'ACTIVE',
      createdAt: nowIso(),
      password: String(body.password),
    };
    db[tenantId] = {
      name: companyName,
      users: [user],
      departments: [],
      positions: [],
      employees: [],
      jobs: [],
      applications: [],
      attendance: [],
      leaves: [],
      balances: [],
    };
    setupUntil.set(tenantId, Date.now() + SETUP_MS);
    return { status: 201, body: { tenantId, token: makeToken(email, tenantId, 'ADMIN_RRHH'), tokenType: 'Bearer', user: publicUser(user) } };
  },
]);

// ── Issue #15: Payroll ──────────────────────────────────────────────────────
interface MockRun {
  runId: string;
  period: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  processed: number;
  totalGross: number;
  totalNet: number;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  /** Momento en que se aceptó (o reintentó) la corrida, para simular el avance por tiempo. */
  acceptedAt: number;
  /** Procesados al aceptar: un reintento continúa desde aquí, como el backend real. */
  base: number;
}
interface MockPayslip {
  payslipId: string;
  runId: string;
  employeeId: string;
  email: string;
  fullName: string;
  period: string;
  baseSalary: number;
  unpaidLeaveDays: number;
  gross: number;
  pensionDeduction: number;
  leaveDeduction: number;
  net: number;
  createdAt: string;
}
const payroll = new Map<string, { runs: MockRun[]; payslips: MockPayslip[] }>();
const PENDING_MS = 3000;
const EMPLOYEES_PER_SECOND = 3;
const round2 = (n: number) => Math.round(n * 100) / 100;

function payrollOf(tenantId: string) {
  let p = payroll.get(tenantId);
  if (!p) {
    p = { runs: [], payslips: [] };
    payroll.set(tenantId, p);
  }
  return p;
}

function eligible(t: TenantDb) {
  return [...t.employees].filter((e) => e.status === 'ACTIVE').sort((a, b) => a.id.localeCompare(b.id));
}

function makePayslip(run: MockRun, e: Employee, index: number): MockPayslip {
  const unpaid = index % 5 === 0 ? 2 : 0;
  const base = Number(e.salary);
  // Igual que payroll/src/calculator.py: bruto = base (mes completo), pensión 13 %, licencia = base/30 por día.
  const leaveDeduction = round2((base / 30) * unpaid);
  const pension = round2(base * 0.13);
  return {
    payslipId: uuid(),
    runId: run.runId,
    employeeId: e.id,
    email: e.email,
    fullName: `${e.firstName} ${e.lastName}`,
    period: run.period,
    baseSalary: base,
    unpaidLeaveDays: unpaid,
    gross: base,
    pensionDeduction: pension,
    leaveDeduction,
    net: round2(base - pension - leaveDeduction),
    createdAt: nowIso(),
  };
}

/** Avanza la corrida según el tiempo transcurrido (simula el worker por lotes). */
function advance(tenantId: string, run: MockRun) {
  if (run.status === 'COMPLETED' || run.status === 'FAILED') return;
  const elapsed = Date.now() - run.acceptedAt;
  if (elapsed < PENDING_MS) return;
  run.status = 'PROCESSING';
  const p = payrollOf(tenantId);
  const people = eligible(db[tenantId]);
  const target = Math.min(people.length, run.base + Math.floor(((elapsed - PENDING_MS) / 1000) * EMPLOYEES_PER_SECOND));
  for (let i = countSlips(p, run.runId); i < target; i += 1) p.payslips.push(makePayslip(run, people[i], i));
  run.processed = countSlips(p, run.runId);
  if (run.processed >= people.length) {
    const slips = p.payslips.filter((s) => s.runId === run.runId);
    run.status = 'COMPLETED';
    run.totalGross = round2(slips.reduce((sum, s) => sum + s.gross, 0));
    run.totalNet = round2(slips.reduce((sum, s) => sum + s.net, 0));
    run.completedAt = nowIso();
  }
}

function countSlips(p: { payslips: MockPayslip[] }, runId: string) {
  return p.payslips.filter((s) => s.runId === runId).length;
}

function publicRun({ acceptedAt: _a, base: _b, ...run }: MockRun) {
  return run;
}

function publicSlip(s: MockPayslip, withName: boolean) {
  const { fullName, ...rest } = s;
  return withName ? { ...rest, fullName } : rest;
}

function offsetPage<T>(items: T[], req: Req) {
  const limit = limitOf(req);
  const offset = Number(req.query.get('offset') ?? '0');
  if (!Number.isInteger(offset) || offset < 0) throw bad('offset debe ser un entero');
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

function periodOffset(months: number): string {
  const [y, m] = todayISO().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Historial de ejemplo: dos meses completados y uno fallido (para probar «Reintentar»).
for (const [tenantId, t] of Object.entries(db)) {
  const p = payrollOf(tenantId);
  const admin = t.users.find((u) => u.role === 'ADMIN_RRHH')?.email ?? 'admin';
  for (const months of [2, 3]) {
    const run: MockRun = {
      runId: uuid(),
      period: periodOffset(months),
      status: 'PROCESSING',
      processed: 0,
      totalGross: 0,
      totalNet: 0,
      createdBy: admin,
      createdAt: `${periodOffset(months - 1)}-01T15:00:00+00:00`,
      completedAt: null,
      acceptedAt: 0,
      base: 0,
    };
    p.runs.push(run);
    advance(tenantId, run);
    run.completedAt = `${periodOffset(months - 1)}-01T15:02:00+00:00`;
  }
  p.runs.push({
    runId: uuid(),
    period: periodOffset(1),
    status: 'FAILED',
    processed: 0,
    totalGross: 0,
    totalNet: 0,
    createdBy: admin,
    createdAt: `${periodOffset(0)}-01T15:00:00+00:00`,
    completedAt: null,
    acceptedAt: 0,
    base: 0,
  });
}

const payrollRoutes: [string, RegExp, Handler][] = [
  [
    'POST',
    /^\/payroll-runs$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH');
      const period = String(req.body.period ?? '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw bad('period debe tener formato YYYY-MM');
      if (period > todayISO().slice(0, 7)) throw bad('period no puede ser un mes futuro');
      const p = payrollOf(ctx.tenantId);
      let run = p.runs.find((r) => r.period === period);
      if (run) advance(ctx.tenantId, run);
      if (run && run.status === 'FAILED') {
        run.status = 'PENDING';
        run.completedAt = null;
        run.acceptedAt = Date.now();
        run.base = run.processed;
      } else if (run && run.status !== 'PENDING') {
        throw conflict('Ya existe una corrida de planilla para ese período');
      } else if (!run) {
        run = {
          runId: uuid(),
          period,
          status: 'PENDING',
          processed: 0,
          totalGross: 0,
          totalNet: 0,
          createdBy: ctx.userId,
          createdAt: nowIso(),
          completedAt: null,
          acceptedAt: Date.now(),
          base: 0,
        };
        p.runs.push(run);
      }
      return { status: 202, body: { runId: run.runId, period, status: 'PENDING' } };
    },
  ],
  [
    'GET',
    /^\/payroll-runs$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH');
      const runs = payrollOf(ctx.tenantId).runs;
      runs.forEach((r) => advance(ctx.tenantId, r));
      return { body: offsetPage([...runs].sort((a, b) => b.period.localeCompare(a.period)).map(publicRun), req) };
    },
  ],
  [
    'GET',
    /^\/payroll-runs\/([^/]+)$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH');
      const run = payrollOf(ctx.tenantId).runs.find((r) => r.runId === req.params[0]);
      if (!run) throw notFound('Corrida de planilla no encontrada');
      advance(ctx.tenantId, run);
      return { body: publicRun(run) };
    },
  ],
  [
    'GET',
    /^\/payroll-runs\/([^/]+)\/payslips$/,
    (req) => {
      const ctx = requireRole(req, 'ADMIN_RRHH');
      const p = payrollOf(ctx.tenantId);
      if (!p.runs.some((r) => r.runId === req.params[0])) throw notFound('Corrida de planilla no encontrada');
      const q = (req.query.get('q') ?? '').trim().toLowerCase();
      if (q.length > 100) throw bad('q admite hasta 100 caracteres');
      const slips = p.payslips
        .filter((s) => s.runId === req.params[0] && (!q || s.email.toLowerCase().includes(q) || s.fullName.toLowerCase().includes(q)))
        .sort((a, b) => a.email.localeCompare(b.email))
        .map((s) => publicSlip(s, true));
      return { body: offsetPage(slips, req) };
    },
  ],
  [
    'GET',
    /^\/payslips\/me$/,
    (req) => {
      const p = payrollOf(req.ctx!.tenantId);
      const mine = p.payslips
        .filter((s) => s.email === req.ctx!.userId.toLowerCase())
        .sort((a, b) => b.period.localeCompare(a.period))
        .map((s) => publicSlip(s, false));
      return { body: offsetPage(mine, req) };
    },
  ],
  [
    'GET',
    /^\/payslips\/([^/]+)\/document-url$/,
    (req) => {
      const ctx = req.ctx!;
      const slip = payrollOf(ctx.tenantId).payslips.find((s) => s.payslipId === req.params[0]);
      if (!slip) throw notFound('Boleta no encontrada');
      if (ctx.role !== 'ADMIN_RRHH' && slip.email !== ctx.userId.toLowerCase()) throw forbidden('No tienes permiso para descargar esta boleta');
      const text = [
        `BOLETA DE PAGO (SIMULADA - SOLO DESARROLLO)`,
        `Empresa: ${db[ctx.tenantId].name}`,
        `Empleado: ${slip.fullName} <${slip.email}>`,
        `Periodo: ${slip.period}`,
        `Salario base: ${slip.baseSalary.toFixed(2)}`,
        `Días de licencia no remunerada: ${slip.unpaidLeaveDays}`,
        `Bruto: ${slip.gross.toFixed(2)}`,
        `Descuento pensión: ${slip.pensionDeduction.toFixed(2)}`,
        `Descuento licencias: ${slip.leaveDeduction.toFixed(2)}`,
        `Neto: ${slip.net.toFixed(2)}`,
        `URL generada: ${nowIso()} (en AWS dura 5 minutos)`,
      ].join('\n');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      return { body: { downloadUrl: url } };
    },
  ],
];

// ── Issue #15: Notifications (contrato del issue; el servicio real aún no existe) ──
interface MockNotification {
  notificationId: string;
  title: string;
  message: string;
  type: string;
  link: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}
const notifications = new Map<string, MockNotification[]>();

function notificationsOf(ctx: Ctx): MockNotification[] {
  const key = `${ctx.tenantId}:${ctx.userId}`;
  let list = notifications.get(key);
  if (!list) {
    const seed: [string, string, string, string | null][] = [
      ['LeaveApproved', 'Solicitud aprobada', 'Tus vacaciones fueron aprobadas.', '/leave'],
      ['PayslipGenerated', 'Boleta disponible', 'Ya puedes descargar tu boleta del mes.', '/payslips'],
      ['Info', 'Nueva vacante publicada', 'Revisa las vacantes abiertas de tu empresa.', '/jobs'],
      ['Info', 'Enlace externo', 'Este enlace apunta fuera de la aplicación y se bloquea.', 'https://example.com/promo'],
      ['Info', 'Bienvenido a TalentCloud', 'Tu cuenta está lista.', null],
    ];
    list = Array.from({ length: 14 }, (_, i) => {
      const [type, title, message, link] = seed[i % seed.length];
      return {
        notificationId: uuid(),
        type,
        title: i < seed.length ? title : `${title} (#${i + 1})`,
        message,
        link,
        read: i >= 3,
        readAt: i >= 3 ? nowIso() : null,
        createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
      };
    });
    notifications.set(key, list);
  }
  return list;
}

const notificationsRoutes: [string, RegExp, Handler][] = [
  ['GET', /^\/notifications\/me\/unread-count$/, (req) => ({ body: { count: notificationsOf(req.ctx!).filter((n) => !n.read).length } })],
  ['GET', /^\/notifications\/me$/, (req) => ({ body: cursorPage(notificationsOf(req.ctx!), req) })],
  [
    'PATCH',
    /^\/notifications\/([^/]+)\/read$/,
    (req) => {
      const n = notificationsOf(req.ctx!).find((x) => x.notificationId === req.params[0]);
      if (!n) throw notFound('Notificación no encontrada');
      if (!n.read) Object.assign(n, { read: true, readAt: nowIso() });
      return { body: n };
    },
  ],
  [
    'POST',
    /^\/notifications\/read-all$/,
    (req) => {
      notificationsOf(req.ctx!).forEach((n) => !n.read && Object.assign(n, { read: true, readAt: nowIso() }));
      return { status: 204 };
    },
  ],
];

const ROUTES: Record<ServiceName, [string, RegExp, Handler][]> = {
  identity: identityRoutes,
  employees: employeesRoutes,
  recruitment: recruitmentRoutes,
  timeLeave: timeLeaveRoutes,
  payroll: payrollRoutes,
  notifications: notificationsRoutes,
};

const PUBLIC_PATHS = new Set(['/auth/login', '/signup']);

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function mockFetch(service: ServiceName, url: string, init: RequestInit): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);

  let ctx: Ctx | null = null;
  if (!PUBLIC_PATHS.has(path)) {
    ctx = authorize(headers.get('Authorization'));
    // Igual que el authorizer de API Gateway: 401 con {message}.
    if (!ctx) return json(401, { message: 'Unauthorized' });
  }

  // Empresa recién registrada: employees y payroll responden 503 unos segundos.
  const until = ctx ? setupUntil.get(ctx.tenantId) : undefined;
  if ((service === 'employees' || service === 'payroll') && until && Date.now() < until) {
    return json(503, { error: 'La empresa se está configurando' });
  }

  for (const [routeMethod, pattern, handler] of ROUTES[service]) {
    const match = path.match(pattern);
    if (!match || routeMethod !== method) continue;
    try {
      let body: Record<string, unknown> = {};
      if (typeof init.body === 'string' && init.body) {
        const parsedBody = JSON.parse(init.body);
        if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) throw bad('El body debe ser un objeto JSON');
        body = parsedBody;
      }
      const result = handler({ method, path, params: match.slice(1), query: parsed.searchParams, body, ctx });
      return json(result.status ?? 200, result.body);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message });
      console.error('[mock]', error);
      return json(500, { error: 'Error interno' });
    }
  }
  return json(403, { message: 'Missing Authentication Token' });
}

export async function mockS3Put(url: string, file: Blob): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS * 2));
  const key = decodeURIComponent(url.replace('mock://s3/', ''));
  cvFiles.set(key, file);
}
