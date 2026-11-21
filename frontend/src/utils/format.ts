const LOCALE = 'es-PE';
/** Los backends calculan "hoy" y las marcaciones en hora de Lima. */
export const BUSINESS_TZ = 'America/Lima';

/** Fecha YYYY-MM-DD de hoy en Lima. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** "2026-03-05" → "5 mar 2026" (sin desplazar por zona horaria). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = value.slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BUSINESS_TZ,
  }).format(date);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TZ }).format(date);
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/**
 * Soles con exactamente 2 decimales y separador de miles: 1234.5 → "S/ 1,234.50".
 * Se arma a mano (sin Intl) para que el resultado no dependa de la versión de ICU del navegador.
 */
export function formatSoles(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return String(value);
  // Desplazamiento decimal en texto: evita que 1.005 * 100 = 100.4999… redondee hacia abajo.
  const abs = Math.abs(amount);
  const text = String(abs);
  const cents = text.includes('e') ? Math.round(abs * 100) : Math.round(Number(`${text}e2`));
  const integer = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = String(cents % 100).padStart(2, '0');
  return `${amount < 0 && cents > 0 ? '-' : ''}S/ ${integer}.${decimals}`;
}

export function formatMoney(value: number | string | null | undefined): string {
  return formatSoles(value);
}

// ── Periodos de planilla (YYYY-MM) ──────────────────────────────────────────
export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mes actual (YYYY-MM) en hora de Lima, igual que payroll/src/schemas.py (LIMA_TIME). */
export function currentPeriod(now: Date = new Date()): string {
  return todayISO(now).slice(0, 7);
}

export function isFuturePeriod(period: string, now: Date = new Date()): boolean {
  return period > currentPeriod(now);
}

/** Valida el periodo elegido en el selector. Devuelve el mensaje de error o undefined. */
export function validatePeriod(period: string, now: Date = new Date()): string | undefined {
  if (!period) return 'Elige el mes de la planilla.';
  if (!PERIOD.test(period)) return 'El periodo debe tener formato YYYY-MM.';
  if (isFuturePeriod(period, now)) return 'No puedes generar la planilla de un mes futuro.';
  return undefined;
}

/** "2026-03" → "Marzo 2026". */
export function formatPeriod(period: string | null | undefined): string {
  if (!period || !PERIOD.test(period)) return period ?? '—';
  const [y, m] = period.split('-').map(Number);
  const month = new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${capitalize(month)} ${y}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Días hábiles (lunes a viernes) entre dos fechas incluidas; igual que time_leave.business_days. */
export function businessDays(startISO: string, endISO: string): number {
  if (!startISO || !endISO || endISO < startISO) return 0;
  let count = 0;
  let current = startISO;
  for (let guard = 0; current <= endISO && guard < 800; guard += 1) {
    const [y, m, d] = current.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    current = addDays(current, 1);
  }
  return count;
}

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
