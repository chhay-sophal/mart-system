import { useCallback, useEffect, useState } from 'react';

/**
 * Fetches `fetcher()` whenever `key` changes (skipped while `key` is null).
 * Loading is derived from whether the stored result belongs to the current
 * key, so the effect never sets state synchronously and a stale response
 * from a previous key can't overwrite a newer one.
 */
export function useResource(key, fetcher) {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState({ id: null, data: undefined, error: null });
  const id = key == null ? null : `${key}#${nonce}`;

  useEffect(() => {
    if (id == null) return;
    let cancelled = false;
    fetcher().then(
      (data) => !cancelled && setResult({ id, data, error: null }),
      (error) => !cancelled && setResult({ id, data: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
    // `fetcher` is a fresh closure every render; `id` already captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const current = id != null && result.id === id;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : null,
    loading: id != null && !current,
    reload,
  };
}
