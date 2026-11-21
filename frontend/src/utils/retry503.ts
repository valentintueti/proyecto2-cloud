import { ApiError } from '../api/http';

/** Tras registrar una empresa, employees y payroll pueden responder 503 ("La empresa se está configurando"). */
export const SETUP_RETRY_INTERVAL_MS = 3000;
export const SETUP_MAX_RETRIES = 5;

export function isCompanySetupError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 503;
}

export interface SetupRetryOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  maxRetries?: number;
  /** Antes de cada espera: número de reintento (1..maxRetries) y mensaje del backend. */
  onRetry?: (attempt: number, message: string) => void;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Reintenta una consulta IDEMPOTENTE (GET) mientras responda 503: cada 3 s y como máximo 5 veces.
 * Nunca usar con POST /signup ni con operaciones que crean datos.
 * Si se agotan los reintentos se propaga el último ApiError 503. Abortar la señal limpia la espera.
 */
export async function retryWhileConfiguring<T>(
  query: (signal?: AbortSignal) => Promise<T>,
  { signal, intervalMs = SETUP_RETRY_INTERVAL_MS, maxRetries = SETUP_MAX_RETRIES, onRetry }: SetupRetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await query(signal);
    } catch (error) {
      if (!isCompanySetupError(error) || attempt >= maxRetries || signal?.aborted) throw error;
      onRetry?.(attempt + 1, error.message);
      await wait(intervalMs, signal);
    }
  }
}
