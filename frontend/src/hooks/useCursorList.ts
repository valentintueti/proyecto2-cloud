import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import type { CursorPage } from '../api/types';
import { errorMessage } from './useAsync';

/**
 * Lista paginada por cursor (nextCursor) con "Cargar más". Se reinicia cuando cambian las dependencias.
 */
export function useCursorList<T>(
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T>>,
  deps: DependencyList,
) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    fetchRef
      .current(null, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.items);
        setNextCursor(page.nextCursor ?? null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setNextCursor(null);
        setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const controller = controllerRef.current ?? new AbortController();
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchRef.current(nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { items, setItems, nextCursor, loading, loadingMore, error, loadMore, reload };
}
