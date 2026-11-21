import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import { currentPeriod, formatMoney, formatPeriod, formatSoles, isFuturePeriod, validatePeriod } from './format';
import { createPoller } from './poller';
import { SETUP_MAX_RETRIES, SETUP_RETRY_INTERVAL_MS, retryWhileConfiguring } from './retry503';
import { openFreshDownload, type OpenedTab } from './download';
import { safeInternalPath } from './links';
import { validateSignup, toSignupRequest } from '../features/signup/signupValidation';
import { totalDeductions } from '../api/payroll';

describe('1. formatSoles (S/ con 2 decimales)', () => {
  it('formato exacto S/ 1,234.50', () => {
    expect(formatSoles(1234.5)).toBe('S/ 1,234.50');
    expect(formatSoles(0)).toBe('S/ 0.00');
    expect(formatSoles(5)).toBe('S/ 5.00');
    expect(formatSoles(1234567.891)).toBe('S/ 1,234,567.89');
    expect(formatSoles('980.1')).toBe('S/ 980.10');
    expect(formatSoles(-45.5)).toBe('-S/ 45.50');
  });

  it('redondea a céntimos sin errores de coma flotante', () => {
    expect(formatSoles(0.1 + 0.2)).toBe('S/ 0.30');
    expect(formatSoles(1.005)).toBe('S/ 1.01');
    expect(formatSoles(-0.001)).toBe('S/ 0.00');
  });

  it('valores vacíos o inválidos', () => {
    expect(formatSoles(null)).toBe('—');
    expect(formatSoles(undefined)).toBe('—');
    expect(formatSoles('')).toBe('—');
    expect(formatSoles('abc')).toBe('abc');
  });

  it('formatMoney (salarios de los módulos anteriores) usa el mismo formato', () => {
    expect(formatMoney(4500)).toBe('S/ 4,500.00');
  });

  it('descuentos totales de una boleta', () => {
    expect(totalDeductions({ pensionDeduction: 585, leaveDeduction: 300.1 })).toBe(885.1);
  });
});

describe('2. selección de mes y bloqueo de meses futuros', () => {
  // 2026-12-01 03:00 UTC = 2026-11-30 22:00 en Lima: el mes local sigue siendo noviembre.
  const limaLateNight = new Date('2026-12-01T03:00:00Z');

  it('el mes actual se calcula en hora de Lima (como payroll/src/schemas.py)', () => {
    expect(currentPeriod(limaLateNight)).toBe('2026-11');
    expect(currentPeriod(new Date('2026-12-01T06:00:00Z'))).toBe('2026-12');
  });

  it('bloquea meses futuros y acepta el actual y los pasados', () => {
    expect(isFuturePeriod('2026-12', limaLateNight)).toBe(true);
    expect(isFuturePeriod('2026-11', limaLateNight)).toBe(false);
    expect(isFuturePeriod('2025-12', limaLateNight)).toBe(false);
    expect(validatePeriod('2026-12', limaLateNight)).toMatch(/mes futuro/);
    expect(validatePeriod('2027-01', limaLateNight)).toMatch(/mes futuro/);
    expect(validatePeriod('2026-11', limaLateNight)).toBeUndefined();
  });

  it('valida el formato YYYY-MM', () => {
    expect(validatePeriod('')).toMatch(/Elige/);
    expect(validatePeriod('2026-13')).toMatch(/YYYY-MM/);
    expect(validatePeriod('2026-1')).toMatch(/YYYY-MM/);
  });

  it('muestra el mes en español', () => {
    expect(formatPeriod('2026-03')).toBe('Marzo 2026');
    expect(formatPeriod('2026-11')).toBe('Noviembre 2026');
  });
});

describe('5. createPoller: intervalo, sin solapamiento y limpieza', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('consulta cada 5 s y se detiene cuando la tarea devuelve false', async () => {
    let calls = 0;
    const poller = createPoller({ task: async () => ++calls < 3, intervalMs: 5000 });
    poller.start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(3);
    expect(poller.running).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
  });

  it('no superpone solicitudes: espera a que termine la anterior', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const poller = createPoller({
      intervalMs: 5000,
      immediate: true,
      task: () =>
        new Promise<boolean>((resolve) => {
          calls += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          setTimeout(() => {
            active -= 1;
            resolve(true);
          }, 12_000); // respuesta más lenta que el intervalo
        }),
    });
    poller.start();
    poller.refresh(); // ignorado: ya hay una en curso
    await vi.advanceTimersByTimeAsync(11_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000 + 5000);
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    poller.stop();
  });

  it('stop() (desmontar o cambiar de corrida) limpia el temporizador y aborta la petición', async () => {
    let signal: AbortSignal | null = null;
    let calls = 0;
    const poller = createPoller({
      intervalMs: 5000,
      immediate: true,
      task: (s) => {
        calls += 1;
        signal = s;
        return new Promise<boolean>(() => undefined);
      },
    });
    poller.start();
    expect(calls).toBe(1);
    poller.stop();
    expect(signal!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un error no detiene el seguimiento salvo que onError devuelva false', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const poller = createPoller({
      intervalMs: 1000,
      immediate: true,
      task: async () => {
        calls += 1;
        throw new Error('red');
      },
      onError: (e) => {
        errors.push(e);
        return errors.length < 2;
      },
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(2);
    expect(poller.running).toBe(false);
  });
});

describe('11. reintentos ante 503 (empresa en preparación)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const configuring = () => new ApiError('La empresa se está configurando', 503, 'employees');

  it('reintenta cada 3 s y devuelve el resultado cuando la empresa queda lista', async () => {
    const query = vi.fn().mockRejectedValueOnce(configuring()).mockRejectedValueOnce(configuring()).mockResolvedValue('ok');
    const onRetry = vi.fn();
    const promise = retryWhileConfiguring(query, { onRetry });
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SETUP_RETRY_INTERVAL_MS - 1);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SETUP_RETRY_INTERVAL_MS);
    await expect(promise).resolves.toBe('ok');
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 'La empresa se está configurando');
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 'La empresa se está configurando');
  });

  it('máximo 5 reintentos (6 intentos en total) y luego propaga el 503', async () => {
    expect(SETUP_RETRY_INTERVAL_MS).toBe(3000);
    expect(SETUP_MAX_RETRIES).toBe(5);
    const query = vi.fn().mockRejectedValue(configuring());
    const promise = retryWhileConfiguring(query);
    const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(3000 * 10);
    await assertion;
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('no reintenta otros errores', async () => {
    const query = vi.fn().mockRejectedValue(new ApiError('Prohibido', 403));
    await expect(retryWhileConfiguring(query)).rejects.toMatchObject({ status: 403 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('abortar (salir de la pantalla) cancela la espera pendiente', async () => {
    const controller = new AbortController();
    const query = vi.fn().mockRejectedValue(configuring());
    const promise = retryWhileConfiguring(query, { signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('7. descarga de boleta con URL obtenida al hacer clic', () => {
  function fakeTab(): OpenedTab & { closed: boolean } {
    return { opener: {}, location: { href: '' }, closed: false, close() { this.closed = true; } };
  }

  it('pide la URL recién al ejecutar la descarga y la abre sin modificarla', async () => {
    const getUrl = vi.fn().mockResolvedValue({ downloadUrl: 'https://bucket.s3.amazonaws.com/tenants/acme/p.pdf?X-Amz-Signature=abc' });
    const tab = fakeTab();
    expect(getUrl).not.toHaveBeenCalled();
    await openFreshDownload(getUrl, () => tab);
    expect(getUrl).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe('https://bucket.s3.amazonaws.com/tenants/acme/p.pdf?X-Amz-Signature=abc');
    expect(tab.opener).toBeNull();
  });

  it('cada clic obtiene una URL nueva (nunca se reutiliza una vencida)', async () => {
    let n = 0;
    const getUrl = vi.fn(async () => ({ downloadUrl: `https://s3.test/doc.pdf?sig=${++n}` }));
    const tabs = [fakeTab(), fakeTab()];
    await openFreshDownload(getUrl, () => tabs[0]);
    await openFreshDownload(getUrl, () => tabs[1]);
    expect(tabs.map((t) => t.location.href)).toEqual(['https://s3.test/doc.pdf?sig=1', 'https://s3.test/doc.pdf?sig=2']);
  });

  it('si falla, cierra la pestaña y propaga el error del backend', async () => {
    const tab = fakeTab();
    await expect(openFreshDownload(() => Promise.reject(new ApiError('Boleta no encontrada', 404)), () => tab)).rejects.toThrow('Boleta no encontrada');
    expect(tab.closed).toBe(true);
  });

  it('rechaza URLs no http(s) y usa la misma pestaña si el navegador bloquea el pop-up', async () => {
    await expect(openFreshDownload(async () => ({ downloadUrl: 'javascript:alert(1)' }), () => null)).rejects.toThrow(/URL de descarga/);
    const fallback = vi.fn();
    await openFreshDownload(async () => ({ downloadUrl: 'https://s3.test/x.pdf' }), () => null, fallback);
    expect(fallback).toHaveBeenCalledWith('https://s3.test/x.pdf');
  });
});

describe('10. validaciones del registro de empresa', () => {
  const valid = { companyName: 'Acme S.A.C.', email: 'Ana@Acme.com ', password: 'secreto123', confirmPassword: 'secreto123' };

  it('acepta un formulario válido y normaliza el correo', () => {
    expect(validateSignup(valid)).toEqual({});
    expect(toSignupRequest(valid)).toEqual({ companyName: 'Acme S.A.C.', email: 'ana@acme.com', password: 'secreto123' });
  });

  it('valida cada campo por separado', () => {
    const errors = validateSignup({ companyName: ' ', email: 'ana@', password: 'corta', confirmPassword: 'otra' });
    expect(errors.companyName).toMatch(/nombre/);
    expect(errors.email).toMatch(/correo válido/);
    expect(errors.password).toMatch(/8 caracteres/);
    expect(errors.confirmPassword).toMatch(/no coinciden/);
  });

  it('mínimo 8 caracteres y contraseñas coincidentes', () => {
    expect(validateSignup({ ...valid, password: '1234567', confirmPassword: '1234567' }).password).toBeDefined();
    expect(validateSignup({ ...valid, password: '12345678', confirmPassword: '12345678' }).password).toBeUndefined();
    expect(validateSignup({ ...valid, confirmPassword: 'secreto124' }).confirmPassword).toMatch(/no coinciden/);
    expect(validateSignup({ ...valid, confirmPassword: '' }).confirmPassword).toMatch(/Repite/);
  });
});

describe('13. links de notificaciones', () => {
  const origin = 'https://app.talentcloud.test';
  it('solo navega a rutas internas o del mismo origen', () => {
    expect(safeInternalPath('/payslips', origin)).toBe('/payslips');
    expect(safeInternalPath('/jobs/123?tab=apps#x', origin)).toBe('/jobs/123?tab=apps#x');
    expect(safeInternalPath('https://app.talentcloud.test/leave', origin)).toBe('/leave');
  });
  it('bloquea destinos externos o peligrosos', () => {
    expect(safeInternalPath('https://evil.example/phish', origin)).toBeNull();
    expect(safeInternalPath('//evil.example', origin)).toBeNull();
    expect(safeInternalPath('/\\evil.example', origin)).toBeNull();
    expect(safeInternalPath('javascript:alert(1)', origin)).toBeNull();
    expect(safeInternalPath('data:text/html,hi', origin)).toBeNull();
    expect(safeInternalPath('', origin)).toBeNull();
    expect(safeInternalPath(null, origin)).toBeNull();
  });
});
