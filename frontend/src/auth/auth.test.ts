import { describe, expect, it } from 'vitest';
import { decodeToken, isExpired } from './jwt';
import { PERMISSIONS, can } from './permissions';

function token(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.firma`;
}

describe('decodeToken', () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;

  it('lee tenantId, role y exp', () => {
    const claims = decodeToken(token({ sub: 'ana@acme.com', tenantId: 'acme', role: 'MANAGER', exp, iat: 1 }));
    expect(claims).toEqual({ sub: 'ana@acme.com', tenantId: 'acme', role: 'MANAGER', exp, iat: 1 });
  });

  it('acepta caracteres no ASCII en el payload', () => {
    const claims = decodeToken(token({ sub: 'josé@acme.com', tenantId: 'acme', role: 'EMPLOYEE', exp }));
    expect(claims?.sub).toBe('josé@acme.com');
  });

  it('rechaza tokens mal formados o con rol desconocido', () => {
    expect(decodeToken('no-es-un-jwt')).toBeNull();
    expect(decodeToken('a.b.c')).toBeNull();
    expect(decodeToken(token({ sub: 'x', tenantId: 'acme', role: 'ROOT', exp }))).toBeNull();
    expect(decodeToken(token({ sub: 'x', role: 'EMPLOYEE', exp }))).toBeNull();
  });
});

describe('isExpired', () => {
  it('un token vencido equivale a no tener sesión', () => {
    const now = Date.now();
    expect(isExpired({ exp: Math.floor(now / 1000) - 1 }, now)).toBe(true);
    expect(isExpired({ exp: Math.floor(now / 1000) + 3600 }, now)).toBe(false);
  });

  it('considera vencido un token a punto de expirar (margen)', () => {
    const now = Date.now();
    expect(isExpired({ exp: Math.floor(now / 1000) + 2 }, now, 5)).toBe(true);
  });
});

describe('permisos por rol (Issue #4)', () => {
  it('solo ADMIN_RRHH gestiona usuarios', () => {
    expect(can('ADMIN_RRHH', 'users.list')).toBe(true);
    expect(can('MANAGER', 'users.list')).toBe(false);
    expect(can('EMPLOYEE', 'users.create')).toBe(false);
  });

  it('lista de empleados: ADMIN_RRHH y MANAGER; alta, edición y baja: solo ADMIN_RRHH', () => {
    expect(can('MANAGER', 'employees.list')).toBe(true);
    expect(can('EMPLOYEE', 'employees.list')).toBe(false);
    expect(can('EMPLOYEE', 'employees.view')).toBe(true);
    for (const p of ['employees.create', 'employees.update', 'employees.terminate', 'org.create'] as const) {
      expect(can('ADMIN_RRHH', p)).toBe(true);
      expect(can('MANAGER', p)).toBe(false);
      expect(can('EMPLOYEE', p)).toBe(false);
    }
  });

  it('vacantes: todos ven, solo ADMIN_RRHH crea/edita; postulaciones: ADMIN_RRHH y MANAGER', () => {
    expect(can('EMPLOYEE', 'jobs.list')).toBe(true);
    expect(can('MANAGER', 'jobs.create')).toBe(false);
    expect(can('MANAGER', 'applications.stage')).toBe(true);
    expect(can('EMPLOYEE', 'applications.list')).toBe(false);
    expect(can('EMPLOYEE', 'applications.cv')).toBe(false);
  });

  it('time & leave: todos marcan y solicitan; aprobar y ver asistencia ajena: ADMIN_RRHH y MANAGER', () => {
    expect(can('EMPLOYEE', 'attendance.self')).toBe(true);
    expect(can('EMPLOYEE', 'leave.self')).toBe(true);
    expect(can('EMPLOYEE', 'leave.approve')).toBe(false);
    expect(can('EMPLOYEE', 'attendance.others')).toBe(false);
    expect(can('MANAGER', 'leave.approve')).toBe(true);
  });

  it('sin rol no hay permisos', () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(can(null, permission)).toBe(false);
    }
  });
});
