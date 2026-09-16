import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { accessTokenRef, apiClient } from '../lib/apiClient';

const REFRESH_TOKEN_KEY = 'ims:refreshToken';
// Access tokens are 15m server-side; refresh a bit early so an in-flight
// request never races an expiry.
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
  const [status, setStatus] = useState(() =>
    localStorage.getItem(REFRESH_TOKEN_KEY) ? 'loading' : 'anonymous'
  ); // 'loading' | 'authenticated' | 'anonymous'
  const refreshTimerRef = useRef(null);

  const applyTokens = useCallback((accessToken, refreshToken) => {
    accessTokenRef.current = accessToken;
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }, []);

  const clearAuth = useCallback(() => {
    accessTokenRef.current = null;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    setUser(null);
    setStores([]);
    setCurrentStoreId(null);
    setStatus('anonymous');
  }, []);

  const loadStores = useCallback(async () => {
    const list = await apiClient.get('/api/stores');
    setStores(list);
    setCurrentStoreId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0]?.id ?? null));
  }, []);

  const scheduleProactiveRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(async () => {
      const raw = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (!raw) return;
      try {
        const res = await apiClient.post('/api/auth/refresh', { refreshToken: raw });
        applyTokens(res.accessToken, res.refreshToken);
      } catch {
        clearAuth();
      }
    }, PROACTIVE_REFRESH_MS);
  }, [applyTokens, clearAuth]);

  const login = useCallback(
    async (email, password) => {
      const res = await apiClient.post('/api/auth/login', { email, password });
      applyTokens(res.accessToken, res.refreshToken);
      setUser({ email });
      await loadStores();
      scheduleProactiveRefresh();
      setStatus('authenticated');
    },
    [applyTokens, loadStores, scheduleProactiveRefresh]
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

  // On mount, try to silently resume a session from the stored refresh token
  // rather than forcing a fresh login every page reload.
  useEffect(() => {
    const raw = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!raw) return;

    (async () => {
      try {
        const res = await apiClient.post('/api/auth/refresh', { refreshToken: raw });
        applyTokens(res.accessToken, res.refreshToken);
        await loadStores();
        scheduleProactiveRefresh();
        setStatus('authenticated');
      } catch {
        clearAuth();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apiClient's onUnauthorized fires on any 401/403 — if our proactive
  // refresh somehow missed, drop the session so the login screen reappears.
  useEffect(() => {
    const handler = () => clearAuth();
    window.addEventListener('ims:unauthorized', handler);
    return () => window.removeEventListener('ims:unauthorized', handler);
  }, [clearAuth]);

  const value = useMemo(
    () => ({ status, user, stores, currentStoreId, setCurrentStoreId, login, logout }),
    [status, user, stores, currentStoreId, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
