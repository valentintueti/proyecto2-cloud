/**
 * Consulta periódica sin solicitudes superpuestas: la siguiente consulta se programa recién
 * cuando termina la anterior. `stop()` cancela el temporizador y aborta la petición en curso.
 */
export interface Poller {
  start: () => void;
  stop: () => void;
  /** Ejecuta una consulta ya (si no hay otra en curso) y reprograma la siguiente. */
  refresh: () => void;
  readonly running: boolean;
}

export interface PollerOptions {
  /** Devuelve true para seguir consultando, false para detenerse (p. ej. estado final). */
  task: (signal: AbortSignal) => Promise<boolean>;
  intervalMs: number;
  /** true: la primera consulta se hace al iniciar; si no, después del primer intervalo. */
  immediate?: boolean;
  /** Error de una consulta. Por defecto se sigue consultando; devolver false detiene el poller. */
  onError?: (error: unknown) => boolean | void;
}

export function createPoller({ task, intervalMs, immediate = false, onError }: PollerOptions): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let running = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (running) timer = setTimeout(run, intervalMs);
  };

  async function run() {
    timer = null;
    if (!running || controller) return; // nunca dos consultas a la vez
    const current = new AbortController();
    controller = current;
    let keepGoing = true;
    try {
      keepGoing = await task(current.signal);
    } catch (error) {
      if (!current.signal.aborted) keepGoing = onError?.(error) !== false;
    } finally {
      if (controller === current) controller = null;
    }
    if (current.signal.aborted || !running) return;
    if (keepGoing) schedule();
    else running = false;
  }

  return {
    start() {
      if (running) return;
      running = true;
      if (immediate) void run();
      else schedule();
    },
    stop() {
      running = false;
      clearTimer();
      controller?.abort();
      controller = null;
    },
    refresh() {
      if (!running || controller) return;
      clearTimer();
      void run();
    },
    get running() {
      return running;
    },
  };
}
