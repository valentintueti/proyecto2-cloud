import type { Role } from '../api/types';

export const ADMIN: Role = 'ADMIN_RRHH';
export const MANAGER: Role = 'MANAGER';
export const EMPLOYEE: Role = 'EMPLOYEE';
const ALL: Role[] = [ADMIN, MANAGER, EMPLOYEE];
const RECRUITERS: Role[] = [ADMIN, MANAGER];

/**
 * Matriz de permisos del Issue #4. Es solo UX: la autorización real la aplica cada backend.
 */
export const PERMISSIONS = {
  'profile.view': ALL,
  'users.list': [ADMIN],
  'users.create': [ADMIN],
  'users.update': [ADMIN],

  'employees.list': RECRUITERS,
  'employees.view': ALL, // EMPLOYEE solo su propia ficha
  'employees.create': [ADMIN],
  'employees.update': [ADMIN],
  'employees.terminate': [ADMIN],
  'org.view': ALL,
  'org.create': [ADMIN],

  'jobs.list': ALL,
  'jobs.view': ALL,
  'jobs.create': [ADMIN],
  'jobs.update': [ADMIN],
  'applications.list': RECRUITERS,
  'applications.create': RECRUITERS,
  'applications.cv': RECRUITERS,
  'applications.stage': RECRUITERS,

  'attendance.self': ALL,
  'attendance.others': RECRUITERS,
  'leave.self': ALL,
  'leave.approve': RECRUITERS,
  'balance.self': ALL,
} as const satisfies Record<string, Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN_RRHH: 'Admin RR. HH.',
  MANAGER: 'Manager',
  EMPLOYEE: 'Empleado',
};
