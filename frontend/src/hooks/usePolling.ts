import { useEffect, useRef, type DependencyList } from 'react';
import { createPoller } from '../utils/poller';

/**
 * Ejecuta `task` cada `intervalMs` mientras `enabled` sea true, sin solicitudes superpuestas.
 * El poller se detiene (y aborta la petición en curso) al desmontar, al cambiar `deps`
 * (p. ej. otra corrida) o cuando `task` devuelve false.
 */
export function usePolling(
  task: (signal: AbortSignal) => Promise<boolean>,
  { intervalMs, enabled, immediate = false, onError }: { intervalMs: number; enabled: boolean; immediate?: boolean; onError?: (error: unknown) => void },
  deps: DependencyList,
): void {
  const taskRef = useRef(task);
  taskRef.current = task;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller({
      task: (signal) => taskRef.current(signal),
      intervalMs,
      immediate,
      onError: (error) => {
        errorRef.current?.(error);
      },
    });
    poller.start();
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, immediate, ...deps]);
}
