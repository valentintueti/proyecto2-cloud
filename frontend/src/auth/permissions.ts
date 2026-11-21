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

  // Issue #15
  'users.delete': [ADMIN],
  'jobs.delete': [ADMIN],
  'applications.delete': [ADMIN],
  'payroll.manage': [ADMIN],
  'payslips.self': ALL,
} as const satisfies Record<string, Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Botón de borrar usuario: solo ADMIN_RRHH y nunca sobre sí mismo (el backend responde 400). */
export function canDeleteUser(role: Role | null | undefined, myEmail: string, targetEmail: string): boolean {
  return can(role, 'users.delete') && myEmail.trim().toLowerCase() !== targetEmail.trim().toLowerCase();
}

/** Botón de borrar postulación: solo ADMIN_RRHH y nunca en HIRED (el backend responde 409). */
export function canDeleteApplication(role: Role | null | undefined, stage: string): boolean {
  return can(role, 'applications.delete') && stage !== 'HIRED';
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN_RRHH: 'Admin RR. HH.',
  MANAGER: 'Manager',
  EMPLOYEE: 'Empleado',
};
