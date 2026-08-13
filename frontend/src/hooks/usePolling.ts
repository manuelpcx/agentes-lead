import { useCallback, useEffect, useState } from 'react';

/**
 * Hace fetch de `fetcher` al montar y cada `intervalMs` (polling corto para la
 * bandeja/hilo en "casi tiempo real").
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs = 4000,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoFetch = useCallback(fetcher, deps);

  useEffect(() => {
    let active = true;
    const run = () =>
      memoFetch()
        .then((d) => active && setData(d))
        .catch((e) => active && setError(e?.message ?? 'Error'));
    run();
    const id = setInterval(run, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [memoFetch, intervalMs]);

  return { data, error, refetch: memoFetch };
}
