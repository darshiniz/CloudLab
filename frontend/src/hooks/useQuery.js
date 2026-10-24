import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Load data from an api.* function, optionally polling.
 *   const { data, loading, error, refresh } = useQuery(() => api.getPolicy(), [], { interval: 5000 })
 * `loading` is only true for the first load, so polling doesn't flash skeletons.
 */
export default function useQuery(fetcher, deps = [], { interval, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      loadedRef.current = true;
      return result;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!loadedRef.current) setLoading(true);
    refresh();
    if (!interval) return undefined;
    const id = setInterval(() => { if (!document.hidden) refresh(); }, interval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, interval, enabled]);

  return { data, setData, error, loading, refresh };
}
