/**
 * Roles, rutas protegidas, menú, campana y aislamiento entre tenants. Se renderiza con
 * react-dom/server (entorno node, sin efectos): verifica qué se monta para cada rol.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, User } from '../api/types';

function token(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.firma`;
}

const exp = Math.floor(Date.now() / 1000) + 3600;
const userFor = (email: string, role: Role): User => ({ userId: email, email, name: 'Ana Pérez', role, status: 'ACTIVE', createdAt: '2026-01-01' });

async function setup(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { sessionStore, sessionKey } = await import('./sessionStore');
  const { AuthProvider } = await import('./AuthContext');
  const { RequirePermission } = await import('./guards');
  const { AppLayout } = await import('../components/layout/AppLayout');
  const { ToastProvider } = await import('../components/ui/Toast');
  const { NAVIGATION } = await import('../components/layout/navigation');
  const perms = await import('./permissions');

  const login = (role: Role, tenantId = 'acme', email = `${role.toLowerCase()}@${tenantId}.com`) =>
    sessionStore.start(token({ sub: email, tenantId, role, exp }), userFor(email, role));

  const render = (path: string) =>
    renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<p>INICIO</p>} />
                <Route element={<RequirePermission permission="payroll.manage" />}>
                  <Route path="payroll" element={<p>PANTALLA_PLANILLAS</p>} />
                  <Route path="payroll/:runId" element={<p>DETALLE_CORRIDA</p>} />
                </Route>
                <Route element={<RequirePermission permission="payslips.self" />}>
                  <Route path="payslips" element={<p>PANTALLA_MIS_BOLETAS</p>} />
                </Route>
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

  return { sessionStore, sessionKey, login, render, NAVIGATION, ...perms };
}

const ENV = {
  VITE_IDENTITY_API_URL: 'https://identity.example.test',
  VITE_EMPLOYEES_API_URL: 'https://employees.example.test',
  VITE_RECRUITMENT_API_URL: 'https://recruitment.example.test',
  VITE_TIMELEAVE_API_URL: 'https://timeleave.example.test',
  VITE_PAYROLL_API_URL: 'https://payroll.example.test',
  VITE_NOTIFICATIONS_API_URL: '',
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('12. roles y rutas protegidas', () => {
  it('matriz de permisos nuevos', async () => {
    const { can } = await setup(ENV);
    expect(can('ADMIN_RRHH', 'payroll.manage')).toBe(true);
    expect(can('MANAGER', 'payroll.manage')).toBe(false);
    expect(can('EMPLOYEE', 'payroll.manage')).toBe(false);
    for (const role of ['ADMIN_RRHH', 'MANAGER', 'EMPLOYEE'] as Role[]) expect(can(role, 'payslips.self')).toBe(true);
    for (const perm of ['users.delete', 'jobs.delete', 'applications.delete'] as const) {
      expect(can('ADMIN_RRHH', perm)).toBe(true);
      expect(can('MANAGER', perm)).toBe(false);
      expect(can('EMPLOYEE', perm)).toBe(false);
    }
  });

  it('borrar usuario: nunca a sí mismo ni sin ser ADMIN_RRHH', async () => {
    const { canDeleteUser } = await setup(ENV);
    expect(canDeleteUser('ADMIN_RRHH', 'admin@acme.com', 'ana@acme.com')).toBe(true);
    expect(canDeleteUser('ADMIN_RRHH', 'admin@acme.com', ' Admin@Acme.com ')).toBe(false);
    expect(canDeleteUser('MANAGER', 'm@acme.com', 'ana@acme.com')).toBe(false);
    expect(canDeleteUser('EMPLOYEE', 'e@acme.com', 'ana@acme.com')).toBe(false);
  });

  it('borrar postulación: oculto en HIRED y para MANAGER/EMPLOYEE', async () => {
    const { canDeleteApplication } = await setup(ENV);
    expect(canDeleteApplication('ADMIN_RRHH', 'APPLIED')).toBe(true);
    expect(canDeleteApplication('ADMIN_RRHH', 'REJECTED')).toBe(true);
    expect(canDeleteApplication('ADMIN_RRHH', 'HIRED')).toBe(false);
    expect(canDeleteApplication('MANAGER', 'APPLIED')).toBe(false);
    expect(canDeleteApplication('EMPLOYEE', 'APPLIED')).toBe(false);
  });

  it('menú: "Planillas" solo para ADMIN_RRHH y "Mis boletas" para todos', async () => {
    const { NAVIGATION, can } = await setup(ENV);
    const visible = (role: Role) => NAVIGATION.flatMap((s) => s.items).filter((i) => !i.permission || can(role, i.permission)).map((i) => i.label);
    expect(visible('ADMIN_RRHH')).toEqual(expect.arrayContaining(['Planillas', 'Mis boletas']));
    expect(visible('MANAGER')).toContain('Mis boletas');
    expect(visible('MANAGER')).not.toContain('Planillas');
    expect(visible('EMPLOYEE')).toContain('Mis boletas');
    expect(visible('EMPLOYEE')).not.toContain('Planillas');
  });

  it('entrar por URL a /payroll sin permiso no monta la pantalla (redirige al inicio)', async () => {
    const { login, render } = await setup(ENV);
    login('EMPLOYEE');
    expect(render('/payroll')).not.toContain('PANTALLA_PLANILLAS');
    expect(render('/payroll/run-1')).not.toContain('DETALLE_CORRIDA');
    expect(render('/payslips')).toContain('PANTALLA_MIS_BOLETAS');
    login('MANAGER');
    expect(render('/payroll')).not.toContain('PANTALLA_PLANILLAS');
    expect(render('/payslips')).toContain('PANTALLA_MIS_BOLETAS');
    login('ADMIN_RRHH');
    expect(render('/payroll')).toContain('PANTALLA_PLANILLAS');
    expect(render('/payroll/run-1')).toContain('DETALLE_CORRIDA');
  });

  it('el menú renderizado de EMPLOYEE no enlaza a /payroll', async () => {
    const { login, render } = await setup(ENV);
    login('EMPLOYEE');
    const html = render('/');
    expect(html).toContain('href="/payslips"');
    expect(html).not.toContain('href="/payroll"');
  });
});

describe('14. campana de notificaciones', () => {
  it('con VITE_NOTIFICATIONS_API_URL vacía no hay campana ni peticiones', async () => {
    const { login, render } = await setup(ENV);
    login('ADMIN_RRHH');
    const html = render('/');
    expect(html).toContain('INICIO');
    expect(html).not.toContain('notif-trigger');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con la variable definida aparece la campana en el encabezado', async () => {
    const { login, render } = await setup({ ...ENV, VITE_NOTIFICATIONS_API_URL: 'https://notifications.example.test' });
    login('EMPLOYEE');
    expect(render('/')).toContain('notif-trigger');
  });
});

describe('15. aislamiento entre tenants', () => {
  it('la clave del árbol autenticado cambia con el tenant y con el usuario', async () => {
    const { login, sessionKey } = await setup(ENV);
    const a = sessionKey(login('ADMIN_RRHH', 'acme', 'ana@acme.com'));
    const b = sessionKey(login('ADMIN_RRHH', 'globex', 'ana@acme.com'));
    const c = sessionKey(login('ADMIN_RRHH', 'acme', 'otro@acme.com'));
    expect(new Set([a, b, c]).size).toBe(3);
    expect(sessionKey(null)).toBe('anon');
  });

  it('el encabezado muestra siempre el tenant de la sesión vigente', async () => {
    const { login, render } = await setup(ENV);
    login('ADMIN_RRHH', 'acme');
    expect(render('/')).toContain('acme');
    login('ADMIN_RRHH', 'globex', 'admin@globex.com');
    const html = render('/');
    expect(html).toContain('globex');
    expect(html).not.toContain('>acme<');
  });
});
