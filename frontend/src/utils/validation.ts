/** Validaciones de formulario alineadas con las de los backends (mismos límites). */

export type Errors<T> = Partial<Record<keyof T, string>>;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;
export const TENANT_ID = /^[a-z][a-z0-9_]{1,30}$/;
export const MIN_PASSWORD = 8;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value.trim());
}

export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isPhone(value: string): boolean {
  return PHONE.test(value.trim());
}

export function required(value: string | null | undefined, label: string, max?: number): string | undefined {
  const text = (value ?? '').trim();
  if (!text) return `${label} es obligatorio.`;
  if (max && text.length > max) return `${label} admite máximo ${max} caracteres.`;
  return undefined;
}

export function maxLength(value: string | null | undefined, label: string, max: number): string | undefined {
  if ((value ?? '').trim().length > max) return `${label} admite máximo ${max} caracteres.`;
  return undefined;
}

export function money(value: string, label: string, { optional = false } = {}): string | undefined {
  if (!value.trim()) return optional ? undefined : `${label} es obligatorio.`;
  const amount = Number(value);
  if (Number.isNaN(amount)) return `${label} debe ser un número.`;
  if (amount < 0 || amount > 99_999_999.99) return `${label} debe estar entre 0 y 99,999,999.99.`;
  return undefined;
}

export function hasErrors<T>(errors: Errors<T>): boolean {
  return Object.values(errors).some(Boolean);
}
