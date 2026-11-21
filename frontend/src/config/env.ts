/**
 * Configuración de las APIs. Las URLs salen SOLO de variables de entorno VITE_*_API_URL.
 */
export type ServiceName = 'identity' | 'employees' | 'recruitment' | 'timeLeave' | 'payroll' | 'notifications';

export const SERVICE_ENV: Record<ServiceName, string> = {
  identity: 'VITE_IDENTITY_API_URL',
  employees: 'VITE_EMPLOYEES_API_URL',
  recruitment: 'VITE_RECRUITMENT_API_URL',
  timeLeave: 'VITE_TIMELEAVE_API_URL',
  payroll: 'VITE_PAYROLL_API_URL',
  notifications: 'VITE_NOTIFICATIONS_API_URL',
};

export const SERVICE_LABEL: Record<ServiceName, string> = {
  identity: 'Identity',
  employees: 'Employees',
  recruitment: 'Recruitment',
  timeLeave: 'Time & Leave',
  payroll: 'Payroll',
  notifications: 'Notifications',
};

const RAW_URLS: Record<ServiceName, string | undefined> = {
  identity: import.meta.env.VITE_IDENTITY_API_URL,
  employees: import.meta.env.VITE_EMPLOYEES_API_URL,
  recruitment: import.meta.env.VITE_RECRUITMENT_API_URL,
  timeLeave: import.meta.env.VITE_TIMELEAVE_API_URL,
  payroll: import.meta.env.VITE_PAYROLL_API_URL,
  notifications: import.meta.env.VITE_NOTIFICATIONS_API_URL,
};

/** Servicios opcionales: si falta su URL la app funciona igual y oculta la funcionalidad. */
const OPTIONAL_SERVICES: ServiceName[] = ['notifications'];

/**
 * Backend simulado: solo existe en `npm run dev` con VITE_USE_MOCKS=true.
 * En un build de producción `import.meta.env.DEV` es false y el código de mocks se elimina.
 */
export const USE_MOCKS: boolean = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true';

/** URL base sin "/" final, o null si no está configurada. */
export function serviceBaseUrl(service: ServiceName): string | null {
  const raw = (RAW_URLS[service] ?? '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

export function missingServices(): ServiceName[] {
  if (USE_MOCKS) return [];
  return (Object.keys(RAW_URLS) as ServiceName[]).filter((s) => !OPTIONAL_SERVICES.includes(s) && !serviceBaseUrl(s));
}

/**
 * Notificaciones: solo se activan si VITE_NOTIFICATIONS_API_URL tiene valor (o en el modo demo).
 * Con la variable vacía no se muestra la campana ni se hace ninguna petición a Notifications.
 */
export function notificationsEnabled(): boolean {
  return USE_MOCKS || serviceBaseUrl('notifications') !== null;
}

/**
 * Registro público de empresas: solo se muestra con VITE_SIGNUP_ENABLED=true (o en el modo demo),
 * porque necesita el endpoint POST /signup de identity.
 */
export function signupEnabled(): boolean {
  return USE_MOCKS || import.meta.env.VITE_SIGNUP_ENABLED === 'true';
}
