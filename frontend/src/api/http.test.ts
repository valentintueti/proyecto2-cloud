import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type HttpModule = typeof import('./http');

async function loadHttp(env: Record<string, string> = {}): Promise<HttpModule> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./http');
}

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ENV = { VITE_IDENTITY_API_URL: 'https://identity.example.test/dev/' };

describe('extractErrorMessage', () => {
  it('acepta {message}, {error} y {Message}', async () => {
    const { extractErrorMessage } = await loadHttp();
    expect(extractErrorMessage({ message: 'a' })).toBe('a');
    expect(extractErrorMessage({ error: 'b' })).toBe('b');
    expect(extractErrorMessage({ Message: 'c' })).toBe('c');
    expect(extractErrorMessage({})).toBeNull();
    expect(extractErrorMessage('texto')).toBeNull();
  });
});

describe('buildQuery', () => {
  it('omite valores vacíos', async () => {
    const { buildQuery } = await loadHttp();
    expect(buildQuery({ limit: 20, cursor: null, q: '', status: undefined, offset: 0 })).toBe('?limit=20&offset=0');
    expect(buildQuery()).toBe('');
  });
});

describe('request', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('usa la URL de la variable de entorno y envía el Bearer token', async () => {
    const http = await loadHttp(ENV);
    http.configureHttp({ getToken: () => 'tok-123', onUnauthorized: vi.fn() });
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const result = await http.request('identity', '/users', { query: { limit: 5 } });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://identity.example.test/dev/users?limit=5');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  it('no envía Authorization en endpoints públicos (login)', async () => {
    const http = await loadHttp(ENV);
    http.configureHttp({ getToken: () => 'tok', onUnauthorized: vi.fn() });
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await http.request('identity', '/auth/login', { method: 'POST', body: { a: 1 }, auth: false });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.body).toBe('{"a":1}');
  });

  it('ante un 401 cierra la sesión y propaga el mensaje', async () => {
    const http = await loadHttp(ENV);
    const onUnauthorized = vi.fn();
    http.configureHttp({ getToken: () => 'tok', onUnauthorized });
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }));

    await expect(http.request('identity', '/me')).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledWith('unauthorized');
  });

  it('un 401 del login (credenciales) no dispara el cierre de sesión', async () => {
    const http = await loadHttp(ENV);
    const onUnauthorized = vi.fn();
    http.configureHttp({ getToken: () => null, onUnauthorized });
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Credenciales inválidas' }));

    await expect(http.request('identity', '/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toMatchObject({
      status: 401,
      message: 'Credenciales inválidas',
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('sin token vigente no llama a la API y trata la sesión como vencida', async () => {
    const http = await loadHttp(ENV);
    const onUnauthorized = vi.fn();
    http.configureHttp({ getToken: () => null, onUnauthorized });

    await expect(http.request('identity', '/me')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledWith('expired');
  });

  it('muestra el {error} del backend y usa un mensaje por defecto si no hay cuerpo', async () => {
    const http = await loadHttp(ENV);
    http.configureHttp({ getToken: () => 'tok', onUnauthorized: vi.fn() });
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'Ese email ya postuló a esta vacante' }));
    await expect(http.request('identity', '/x')).rejects.toMatchObject({ status: 409, message: 'Ese email ya postuló a esta vacante' });

    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(http.request('identity', '/x')).rejects.toMatchObject({ status: 403, message: 'No tienes permiso para realizar esta acción.' });
  });

  it('error de red → ApiError con status 0', async () => {
    const http = await loadHttp(ENV);
    http.configureHttp({ getToken: () => 'tok', onUnauthorized: vi.fn() });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(http.request('identity', '/me')).rejects.toMatchObject({ status: 0 });
  });

  it('si falta la variable de entorno no hace la petición', async () => {
    const http = await loadHttp(ENV);
    http.configureHttp({ getToken: () => 'tok', onUnauthorized: vi.fn() });
    await expect(http.request('employees', '/employees')).rejects.toThrow(/VITE_EMPLOYEES_API_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUT a S3 sin Authorization y con Content-Type application/pdf', async () => {
    const http = await loadHttp(ENV);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await http.putToPresignedUrl('https://bucket.s3.amazonaws.com/k?X-Amz-Signature=1', new Blob(['%PDF']), 'application/pdf');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/pdf' });
  });
});
