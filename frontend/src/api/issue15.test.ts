/**
 * Integración del cliente HTTP con los contratos del Issue #15. `fetch` está simulado:
 * estas pruebas NO llaman a AWS ni a los mocks de desarrollo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV = {
  VITE_IDENTITY_API_URL: 'https://identity.example.test/dev',
  VITE_EMPLOYEES_API_URL: 'https://employees.example.test/dev',
  VITE_RECRUITMENT_API_URL: 'https://recruitment.example.test/dev',
  VITE_TIMELEAVE_API_URL: 'https://timeleave.example.test/dev',
  VITE_PAYROLL_API_URL: 'https://payroll.example.test/dev/',
};

function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

async function load(env: Record<string, string> = ENV) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const http = await import('./http');
  const onUnauthorized = vi.fn();
  let token: string | null = 'tok-acme';
  http.configureHttp({ getToken: () => token, onUnauthorized });
  return {
    http,
    onUnauthorized,
    setToken: (t: string | null) => (token = t),
    payroll: await import('./payroll'),
    identity: await import('./identity'),
    recruitment: await import('./recruitment'),
    notifications: await import('./notifications'),
    env: await import('../config/env'),
    poller: await import('../utils/poller'),
  };
}

const run = (status: string, processed: number) => ({
  runId: 'run-1',
  period: '2026-10',
  status,
  processed,
  totalGross: status === 'COMPLETED' ? 12345.5 : 0,
  totalNet: status === 'COMPLETED' ? 10740.59 : 0,
  createdBy: 'admin@acme.com',
  createdAt: '2026-11-02T15:00:00+00:00',
  completedAt: status === 'COMPLETED' ? '2026-11-02T15:01:00+00:00' : null,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Payroll API', () => {
  it('lista corridas con limit/offset, la URL de VITE_PAYROLL_API_URL y Bearer', async () => {
    const { payroll } = await load();
    fetchMock.mockResolvedValue(json(200, { items: [run('COMPLETED', 3)], total: 1, limit: 10, offset: 0 }));
    const page = await payroll.payrollApi.listRuns({ limit: 10, offset: 20 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://payroll.example.test/dev/payroll-runs?limit=10&offset=20');
    expect(init.headers.Authorization).toBe('Bearer tok-acme');
    expect(page.items[0].totalNet).toBe(10740.59);
  });

  it('POST /payroll-runs envía {period} e interpreta 202 como aceptada (PENDING)', async () => {
    const { payroll } = await load();
    fetchMock.mockResolvedValue(json(202, { runId: 'run-1', period: '2026-10', status: 'PENDING' }));
    const accepted = await payroll.payrollApi.createRun('2026-10');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://payroll.example.test/dev/payroll-runs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ period: '2026-10' });
    expect(accepted.status).toBe('PENDING');
    expect(payroll.isRunActive(accepted.status)).toBe(true);
  });

  it('6. 409: muestra el mensaje real del backend', async () => {
    const { payroll, http } = await load();
    fetchMock.mockResolvedValue(json(409, { error: 'Ya existe una corrida de planilla para ese período' }));
    const error = await payroll.payrollApi.createRun('2026-10').catch((e) => e);
    expect(error).toBeInstanceOf(http.ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('Ya existe una corrida de planilla para ese período');
  });

  it('3. PENDING → PROCESSING → COMPLETED sin recargar: polling cada 5 s hasta el estado final', async () => {
    vi.useFakeTimers();
    const { payroll, poller } = await load();
    fetchMock
      .mockResolvedValueOnce(json(200, run('PENDING', 0)))
      .mockResolvedValueOnce(json(200, run('PROCESSING', 4)))
      .mockResolvedValueOnce(json(200, run('PROCESSING', 9)))
      .mockResolvedValueOnce(json(200, run('COMPLETED', 12)));
    const seen: [string, number][] = [];
    const finished = vi.fn();
    const p = poller.createPoller({
      intervalMs: payroll.RUN_POLL_INTERVAL_MS,
      task: payroll.runPollTask((signal) => payroll.payrollApi.getRun('run-1', signal), {
        onUpdate: (r) => seen.push([r.status, r.processed]),
        onFinish: finished,
      }),
    });
    expect(payroll.RUN_POLL_INTERVAL_MS).toBe(5000);
    p.start();
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([
      ['PENDING', 0],
      ['PROCESSING', 4],
      ['PROCESSING', 9],
      ['COMPLETED', 12],
    ]);
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ status: 'COMPLETED', totalGross: 12345.5 }));
    expect(fetchMock.mock.calls[0][0]).toBe('https://payroll.example.test/dev/payroll-runs/run-1');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4); // se detuvo en COMPLETED
    expect(p.running).toBe(false);
  });

  it('4. FAILED detiene el polling y el reintento vuelve a llamar POST con el mismo periodo', async () => {
    vi.useFakeTimers();
    const { payroll, poller } = await load();
    fetchMock.mockResolvedValueOnce(json(200, run('PROCESSING', 5))).mockResolvedValueOnce(json(200, run('FAILED', 5)));
    const finished = vi.fn();
    const p = poller.createPoller({
      intervalMs: 5000,
      task: payroll.runPollTask((s) => payroll.payrollApi.getRun('run-1', s), { onUpdate: () => undefined, onFinish: finished }),
    });
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(json(202, { runId: 'run-1', period: '2026-10', status: 'PENDING' }));
    const retried = await payroll.payrollApi.createRun('2026-10');
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe('https://payroll.example.test/dev/payroll-runs');
    expect(JSON.parse(init.body)).toEqual({ period: '2026-10' });
    expect(retried).toEqual({ runId: 'run-1', period: '2026-10', status: 'PENDING' });
  });

  it('boletas de una corrida con búsqueda q y paginación', async () => {
    const { payroll } = await load();
    fetchMock.mockResolvedValue(json(200, { items: [], total: 0, limit: 20, offset: 40 }));
    await payroll.payrollApi.listRunPayslips('run 1', { limit: 20, offset: 40, q: '  ana  ' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://payroll.example.test/dev/payroll-runs/run%201/payslips?limit=20&offset=40&q=ana');
  });

  it('7. mis boletas y URL de descarga pedida bajo demanda', async () => {
    const { payroll } = await load();
    fetchMock.mockResolvedValueOnce(json(200, { items: [], total: 0, limit: 12, offset: 0 }));
    await payroll.payrollApi.myPayslips({ limit: 12, offset: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://payroll.example.test/dev/payslips/me?limit=12&offset=0');
    expect(fetchMock).toHaveBeenCalledTimes(1); // listar no pide URLs de descarga

    fetchMock.mockResolvedValueOnce(json(200, { downloadUrl: 'https://s3.test/a.pdf?sig=1' }));
    const { downloadUrl } = await payroll.payrollApi.payslipDocumentUrl('slip-1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://payroll.example.test/dev/payslips/slip-1/document-url');
    expect(downloadUrl).toBe('https://s3.test/a.pdf?sig=1');
  });
});

describe('8–9. DELETE: 204 sin cuerpo y conflictos', () => {
  it('204 No Content devuelve undefined sin intentar parsear JSON', async () => {
    const { identity, recruitment } = await load();
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(identity.identityApi.deleteUser('ana+rrhh@acme.com')).resolves.toBeUndefined();
    await expect(recruitment.recruitmentApi.deleteJob('job-1')).resolves.toBeUndefined();
    await expect(recruitment.recruitmentApi.deleteApplication('job-1', 'app-1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['DELETE', 'https://identity.example.test/dev/users/ana%2Brrhh%40acme.com'],
      ['DELETE', 'https://recruitment.example.test/dev/jobs/job-1'],
      ['DELETE', 'https://recruitment.example.test/dev/jobs/job-1/applications/app-1'],
    ]);
    // DELETE sin body no envía Content-Type
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });

  it.each([
    [400, 'No puedes eliminar tu propio usuario'],
    [403, "El rol 'EMPLOYEE' no puede realizar esta acción"],
    [404, 'Usuario no encontrado'],
    [409, 'Da de baja al empleado en lugar de borrar el usuario'],
  ])('usuario: %i muestra el mensaje del backend', async (status, message) => {
    const { identity } = await load();
    fetchMock.mockResolvedValue(json(status, { error: message }));
    await expect(identity.identityApi.deleteUser('x@acme.com')).rejects.toMatchObject({ status, message });
  });

  it('vacante con postulaciones y postulación HIRED: 409 con su mensaje', async () => {
    const { recruitment } = await load();
    fetchMock.mockResolvedValueOnce(json(409, { error: 'Elimina o cierra primero sus postulaciones' }));
    await expect(recruitment.recruitmentApi.deleteJob('job-1')).rejects.toMatchObject({ status: 409, message: 'Elimina o cierra primero sus postulaciones' });
    fetchMock.mockResolvedValueOnce(json(409, { error: 'No se puede eliminar una postulación contratada' }));
    await expect(recruitment.recruitmentApi.deleteApplication('job-1', 'app-1')).rejects.toMatchObject({
      status: 409,
      message: 'No se puede eliminar una postulación contratada',
    });
  });

  it('error sin cuerpo usa un mensaje por defecto', async () => {
    const { recruitment } = await load();
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }));
    await expect(recruitment.recruitmentApi.deleteJob('job-1')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/conflicto/) });
  });
});

describe('10. registro de empresa (POST /signup)', () => {
  it('es público (sin Bearer) y devuelve tenantId, token y user', async () => {
    const { identity, setToken } = await load();
    setToken(null);
    fetchMock.mockResolvedValue(json(201, { tenantId: 'acme_sac', token: 'tok', user: { email: 'ana@acme.com' } }));
    const res = await identity.identityApi.signup({ companyName: 'Acme SAC', email: 'ana@acme.com', password: 'secreto123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://identity.example.test/dev/signup');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ companyName: 'Acme SAC', email: 'ana@acme.com', password: 'secreto123' });
    expect(res.tenantId).toBe('acme_sac');
  });

  it('un error del backend se muestra tal cual y POST /signup nunca se reintenta solo', async () => {
    vi.useFakeTimers();
    const { identity } = await load();
    fetchMock.mockResolvedValue(json(503, { error: 'La empresa se está configurando' }));
    await expect(identity.identityApi.signup({ companyName: 'X', email: 'a@b.co', password: '12345678' })).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('11. 503 de Employees/Payroll con reintentos sobre GET', () => {
  it('reintenta GET /payslips/me hasta que deja de responder 503', async () => {
    vi.useFakeTimers();
    const { payroll } = await load();
    const { retryWhileConfiguring } = await import('../utils/retry503');
    fetchMock
      .mockResolvedValueOnce(json(503, { error: 'La empresa se está configurando' }))
      .mockResolvedValueOnce(json(503, { error: 'La empresa se está configurando' }))
      .mockResolvedValueOnce(json(200, { items: [], total: 0, limit: 1, offset: 0 }));
    const messages: string[] = [];
    const promise = retryWhileConfiguring((s) => payroll.payrollApi.myPayslips({ limit: 1 }, s), { onRetry: (_n, m) => messages.push(m) });
    await vi.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toMatchObject({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect(messages).toEqual(['La empresa se está configurando', 'La empresa se está configurando']);
  });
});

describe('13–14. notificaciones', () => {
  const NOTIF_ENV = { ...ENV, VITE_NOTIFICATIONS_API_URL: 'https://notifications.example.test/dev' };

  it('14. con VITE_NOTIFICATIONS_API_URL vacía: deshabilitadas y no se exige como variable', async () => {
    const { env } = await load({ ...ENV, VITE_NOTIFICATIONS_API_URL: '' });
    expect(env.notificationsEnabled()).toBe(false);
    expect(env.missingServices()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con la variable definida se habilitan', async () => {
    const { env } = await load(NOTIF_ENV);
    expect(env.notificationsEnabled()).toBe(true);
  });

  it('contador de no leídas, lista por cursor, marcar una y marcar todas', async () => {
    const { notifications } = await load(NOTIF_ENV);
    fetchMock
      .mockResolvedValueOnce(json(200, { unread: 3 }))
      .mockResolvedValueOnce(
        json(200, {
          items: [
            { notificationId: 'n1', title: 'Boleta disponible', read: false, createdAt: '2026-11-01T10:00:00Z', link: '/payslips' },
            { notificationId: 'n2', title: 'Vieja', readAt: '2026-10-01T10:00:00Z', createdAt: '2026-10-01T09:00:00Z' },
          ],
          nextCursor: 'abc',
        }),
      )
      .mockResolvedValueOnce(json(200, { notificationId: 'n1', read: true }))
      .mockResolvedValueOnce(json(200, { updated: 1 }));

    expect(await notifications.notificationsApi.unreadCount()).toBe(3);
    const page = await notifications.notificationsApi.list({ limit: 10, cursor: 'xyz' });
    expect(page.nextCursor).toBe('abc');
    expect(page.items.map((n) => [n.notificationId, n.read])).toEqual([
      ['n1', false],
      ['n2', true],
    ]);
    await notifications.notificationsApi.markRead('n1');
    await expect(notifications.notificationsApi.markAllRead()).resolves.toEqual({ updated: 1 });

    expect(fetchMock.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['GET', 'https://notifications.example.test/dev/notifications/me/unread-count'],
      ['GET', 'https://notifications.example.test/dev/notifications/me?limit=10&cursor=xyz'],
      ['PATCH', 'https://notifications.example.test/dev/notifications/n1/read'],
      ['POST', 'https://notifications.example.test/dev/notifications/read-all'],
    ]);
  });

  it('un 401 de Notifications no cierra la sesión del resto de la app', async () => {
    const { notifications, identity, onUnauthorized } = await load(NOTIF_ENV);
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Unauthorized' }));
    await expect(notifications.notificationsApi.unreadCount()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    // El manejo global de 401 sigue igual para las demás APIs.
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Unauthorized' }));
    await expect(identity.identityApi.me()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledWith('unauthorized');
  });

  it('contador: contrato real {unread}; tolera {count} y valores inválidos', async () => {
    const { notifications } = await load(NOTIF_ENV);
    fetchMock
      .mockResolvedValueOnce(json(200, { unread: 4 }))
      .mockResolvedValueOnce(json(200, { count: 7 }))
      .mockResolvedValueOnce(json(200, { unread: -2 }));
    expect(await notifications.notificationsApi.unreadCount()).toBe(4);
    expect(await notifications.notificationsApi.unreadCount()).toBe(7);
    expect(await notifications.notificationsApi.unreadCount()).toBe(0);
  });

  it('PAYSLIP_READY (link /payroll del backend) lleva a Mis boletas; el resto respeta su link', async () => {
    const { notifications } = await load(NOTIF_ENV);
    expect(notifications.notificationLink({ type: 'PAYSLIP_READY', link: '/payroll' })).toBe('/payslips');
    expect(notifications.notificationLink({ type: 'LEAVE_APPROVED', link: '/leave' })).toBe('/leave');
    expect(notifications.notificationLink({ type: 'WELCOME', link: null })).toBeNull();
  });

  it('normaliza el ítem real de la bandeja (docs/notifications-model.json)', async () => {
    const { notifications } = await load(NOTIF_ENV);
    const n = notifications.normalizeNotification({
      notificationId: '8f0c7c0e-1f43-5b8e-9d55-1c4a0f6f2b11',
      email: 'empleado@acme.com',
      type: 'LEAVE_APPROVED',
      title: 'Solicitud aprobada',
      message: 'Tu solicitud fue aprobada.',
      link: '/leave',
      read: true,
      readAt: '2026-11-20T16:00:00+00:00',
      sourceEventId: 'evt-1',
      createdAt: '2026-11-20T15:04:05Z',
    });
    expect(n).toMatchObject({ type: 'LEAVE_APPROVED', read: true, link: '/leave', sourceEventId: 'evt-1', email: 'empleado@acme.com' });
  });
});

describe('15. aislamiento entre tenants', () => {
  it('cada petición usa el token de la sesión vigente (nunca uno cacheado de otro tenant)', async () => {
    const { payroll, setToken } = await load();
    fetchMock.mockImplementation(async () => json(200, { items: [], total: 0, limit: 10, offset: 0 }));
    await payroll.payrollApi.listRuns({ limit: 10 });
    setToken('tok-globex');
    await payroll.payrollApi.listRuns({ limit: 10 });
    expect(fetchMock.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(['Bearer tok-acme', 'Bearer tok-globex']);
  });

  it('el tenantId nunca viaja en la URL ni en el body de Payroll', async () => {
    const { payroll } = await load();
    fetchMock.mockImplementation(async () => json(202, { runId: 'r', period: '2026-10', status: 'PENDING' }));
    await payroll.payrollApi.createRun('2026-10');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toMatch(/acme|tenant/);
    expect(JSON.parse(init.body)).toEqual({ period: '2026-10' });
  });

  it('sin sesión no se llama a ninguna API protegida', async () => {
    const { payroll, setToken, onUnauthorized } = await load();
    setToken(null);
    await expect(payroll.payrollApi.myPayslips({})).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledWith('expired');
  });

  it('falta VITE_PAYROLL_API_URL: error claro y ninguna petición', async () => {
    const { payroll } = await load({ ...ENV, VITE_PAYROLL_API_URL: '' });
    await expect(payroll.payrollApi.listRuns({})).rejects.toThrow(/VITE_PAYROLL_API_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
