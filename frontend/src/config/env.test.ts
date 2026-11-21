import { afterEach, describe, expect, it, vi } from 'vitest';
import { signupEnabled } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('registro de empresas (VITE_SIGNUP_ENABLED)', () => {
  it('está apagado si la variable no existe', () => {
    vi.stubEnv('VITE_SIGNUP_ENABLED', '');
    expect(signupEnabled()).toBe(false);
  });

  it('se activa solo con el valor true', () => {
    vi.stubEnv('VITE_SIGNUP_ENABLED', 'true');
    expect(signupEnabled()).toBe(true);
    vi.stubEnv('VITE_SIGNUP_ENABLED', 'false');
    expect(signupEnabled()).toBe(false);
  });
});
