import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { accessTokenRef, apiClient } from '../lib/apiClient';
import { queryClient, queryKeys } from '../lib/queryClient';
import { setTabSyncUser } from '../lib/tabSync';
import { clearFilterState } from '../lib/filterState';
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  clearStoredTokens,
  getFreshTokens,
  hasStoredSession,
  storeTokens,
  userIdOfToken,
} from '../lib/session';

// Access tokens are 15m server-side; refresh a bit early so an in-flight
// request never races an expiry. Every open tab runs this timer, but
// getFreshTokens() (lib/session.js) lets only one of them hit the server.
const PROACTIVE_REFRESH_MS = 12 * 60 * 1000;

const AuthContext = createContext(null);

// Splitting this hook into its own file to satisfy Fast Refresh would touch
// every one of its importers (essentially every page) for a DX-only rule.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [stores, setStores] = useState([]);
  const [currentStoreId, setCurrentStoreId] = useState(null);
  // Computed directly from localStorage rather than flipped post-mount — if
  // there's no stored refresh token there's nothing to resume, so 'anonymous'
  // is correct from the very first render.
  const [status, setStatus] = useState(() => (hasStoredSession() ? 'loading' : 'anonymous')); // 'loading' | 'authenticated' | 'anonymous'
  const refreshTimerRef = useRef(null);

  // This tab's in-memory use of the session: the requests' bearer token and
  // tab sync's user. Storage is written by whoever obtained the token.
  const adoptAccessToken = useCallback((accessToken) => {
    accessTokenRef.current = accessToken;
    // Lets other open tabs share their cache with this one (lib/tabSync.js);
    // set before any page mounts, so it can start from their data.
    setTabSyncUser(userIdOfToken(accessToken));
  }, []);

  // Signs this tab out. `keepStorage` when another tab already ended (or
  // replaced) the shared session, so its storage isn't this tab's to clear.
  const clearAuth = useCallback((keepStorage = false) => {
    accessTokenRef.current = null;
    // Cached data belongs to the signed-in user; never show it to the next
    // one, and stop exchanging it with other tabs.
    setTabSyncUser(null);
    queryClient.clear();
    // Remembered filters (store ids, ranges) were the last user's too.
    clearFilterState();
    if (!keepStorage) clearStoredTokens();
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    setUser(null);
    setStores([]);
    setCurrentStoreId(null);
    setStatus('anonymous');
  }, []);

  // Through the cache, so a tab opened next to an already signed-in one
  // reuses its list. `force` (after a rename) always refetches.
  const loadStores = useCallback(async (force = false) => {
    const list = await queryClient.fetchQuery({
      queryKey: queryKeys.stores(),
      queryFn: () => apiClient.get('/api/stores'),
      ...(force ? { staleTime: 0 } : {}),
    });
    setStores(list);
    setCurrentStoreId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0]?.id ?? null));
  }, []);

  const scheduleProactiveRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(async () => {
      if (!hasStoredSession()) return;
      try {
        adoptAccessToken((await getFreshTokens()).accessToken);
      } catch {
        clearAuth();
      }
    }, PROACTIVE_REFRESH_MS);
  }, [adoptAccessToken, clearAuth]);

  const login = useCallback(
    async (username, password) => {
      const res = await apiClient.post('/api/auth/login', { username, password });
      storeTokens(res.accessToken, res.refreshToken);
      adoptAccessToken(res.accessToken);
      setUser({ username: username.trim().toLowerCase() });
      await loadStores();
      scheduleProactiveRefresh();
      setStatus('authenticated');
    },
    [adoptAccessToken, loadStores, scheduleProactiveRefresh]
  );

  const logout = useCallback(async () => {
    const raw = localStorage.getItem(REFRESH_TOKEN_KEY);
    clearAuth();
    if (raw) {
      try {
        await apiClient.post('/api/auth/logout', { refreshToken: raw });
      } catch {
        // Best effort — the local session is already cleared either way.
      }
    }
  }, [clearAuth]);

  // On mount, try to silently resume a session from the stored tokens rather
  // than forcing a fresh login every page reload. With another tab open,
  // that's usually its still-valid access token: no request at all.
  useEffect(() => {
    if (!hasStoredSession()) return;

    (async () => {
      try {
        adoptAccessToken((await getFreshTokens()).accessToken);
        await loadStores();
        scheduleProactiveRefresh();
        setStatus('authenticated');
      } catch {
        clearAuth();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Another tab changed the shared session. A refresh: adopt its new access
  // token. A sign-out: sign this tab out too. A sign-in as someone else:
  // reload, so nothing of this tab's old user (cache, UI state) survives.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const onStorage = (e) => {
      if (e.key === REFRESH_TOKEN_KEY && !e.newValue) {
        clearAuth(true);
      } else if (e.key === ACCESS_TOKEN_KEY && e.newValue) {
        if (userIdOfToken(e.newValue) !== userIdOfToken(accessTokenRef.current)) window.location.reload();
        else adoptAccessToken(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [status, clearAuth, adoptAccessToken]);

  // apiClient's onUnauthorized fires on any 401/403 — if our proactive
  // refresh somehow missed, drop the session so the login screen reappears.
  useEffect(() => {
    const handler = () => clearAuth();
    window.addEventListener('ims:unauthorized', handler);
    return () => window.removeEventListener('ims:unauthorized', handler);
  }, [clearAuth]);

  const value = useMemo(
    // reloadStores: re-reads the store picker's list, e.g. after a rename.
    () => ({ status, user, stores, currentStoreId, setCurrentStoreId, login, logout, reloadStores: () => loadStores(true) }),
    [status, user, stores, currentStoreId, login, logout, loadStores]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
