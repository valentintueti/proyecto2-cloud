/**
 * Cliente HTTP común a las cuatro APIs. Los componentes nunca llaman a fetch directamente:
 * usan los módulos api/identity.ts, api/employees.ts, api/recruitment.ts y api/timeLeave.ts.
 */
import { SERVICE_ENV, SERVICE_LABEL, USE_MOCKS, serviceBaseUrl, type ServiceName } from '../config/env';

export class ApiError extends Error {
  readonly status: number;
  readonly service: ServiceName | null;

  constructor(message: string, status: number, service: ServiceName | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.service = service;
  }
}

export type UnauthorizedReason = 'expired' | 'unauthorized';

interface HttpConfig {
  /** Token vigente o null. Debe devolver null si el token ya venció. */
  getToken: () => string | null;
  /** Se llama ante un 401 (o token vencido) en cualquier API protegida. */
  onUnauthorized: (reason: UnauthorizedReason) => void;
}

let config: HttpConfig = {
  getToken: () => null,
  onUnauthorized: () => undefined,
};

export function configureHttp(next: HttpConfig): void {
  config = next;
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'La solicitud no es válida.',
  401: 'Tu sesión no es válida. Vuelve a iniciar sesión.',
  403: 'No tienes permiso para realizar esta acción.',
  404: 'No se encontró el recurso solicitado.',
  409: 'La operación entra en conflicto con el estado actual.',
  500: 'Error interno del servidor. Inténtalo de nuevo más tarde.',
  502: 'El servicio no está disponible en este momento.',
  503: 'El servicio no está disponible en este momento.',
  504: 'El servicio tardó demasiado en responder.',
};

/**
 * Mensaje de error del backend. El Issue #4 indica `{message}`; los handlers (common.http)
 * devuelven `{error}` y API Gateway usa `{message}` o `{Message}`. Se aceptan los tres.
 */
export function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['message', 'error', 'Message']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function defaultMessage(status: number): string {
  return DEFAULT_MESSAGES[status] ?? `Error inesperado (HTTP ${status}).`;
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** false solo para endpoints públicos (login). */
  auth?: boolean;
  signal?: AbortSignal;
}

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function transport(service: ServiceName, url: string, init: RequestInit): Promise<Response> {
  if (USE_MOCKS) {
    // Import dinámico: el backend simulado no entra en el bundle de producción.
    const { mockFetch } = await import('../mocks/server');
    return mockFetch(service, url, init);
  }
  return fetch(url, init);
}

export async function request<T>(service: ServiceName, path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal } = options;
  const base = USE_MOCKS ? `mock://${service}` : serviceBaseUrl(service);
  if (!base) {
    throw new ApiError(
      `Falta configurar ${SERVICE_ENV[service]} para conectar con ${SERVICE_LABEL[service]}.`,
      0,
      service,
    );
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = config.getToken();
    if (!token) {
      config.onUnauthorized('expired');
      throw new ApiError('Tu sesión expiró. Vuelve a iniciar sesión.', 401, service);
    }
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await transport(service, `${base}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      `No se pudo conectar con ${SERVICE_LABEL[service]}. Revisa tu conexión o inténtalo más tarde.`,
      0,
      service,
    );
  }

  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && auth) config.onUnauthorized('unauthorized');
    const message = extractErrorMessage(data) ?? defaultMessage(response.status);
    throw new ApiError(message, response.status, service);
  }
  return data as T;
}

/**
 * Subida directa a S3 con la URL prefirmada. Sin Authorization: la firma va en la URL.
 * El Content-Type debe coincidir con el usado al firmar (application/pdf).
 */
export async function putToPresignedUrl(url: string, file: Blob, contentType: string): Promise<void> {
  if (USE_MOCKS && url.startsWith('mock://')) {
    const { mockS3Put } = await import('../mocks/server');
    return mockS3Put(url, file);
  }
  let response: Response;
  try {
    response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  } catch {
    throw new ApiError('No se pudo subir el archivo a S3. Revisa tu conexión o la configuración CORS del bucket.', 0);
  }
  if (!response.ok) {
    throw new ApiError(`S3 rechazó la subida del archivo (HTTP ${response.status}). La URL puede haber expirado.`, response.status);
  }
}
