import { apiClient } from './apiClient';

// The signed-in session's tokens, shared by every open IMS tab through
// localStorage. Refresh tokens are single-use: the server rotates them on
// every refresh and treats a reused one as stolen, revoking every session.
// So tabs must never refresh with the same token at once -- getFreshTokens()
// takes a cross-tab lock, and a tab that finds another one has just
// refreshed adopts its tokens instead of spending the refresh token again.
// (The access token sits beside the refresh token, which is the more
// powerful of the two, so storing it adds no exposure.)

export const REFRESH_TOKEN_KEY = 'ims:refreshToken';
export const ACCESS_TOKEN_KEY = 'ims:accessToken';
const LOCK_NAME = 'ims:token-refresh';
// A stored access token with less than this left is refreshed rather than
// adopted. Access tokens live 15 minutes server-side.
const MIN_REMAINING_MS = 3 * 60_000;

function tokenPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** The user id (`sub`) inside an access token, unverified: for telling sessions apart, not for trust. */
export const userIdOfToken = (token) => tokenPayload(token)?.sub ?? null;

const msLeft = (token) => {
  const exp = tokenPayload(token)?.exp;
  return exp ? exp * 1000 - Date.now() : 0;
};

export const hasStoredSession = () => Boolean(localStorage.getItem(REFRESH_TOKEN_KEY));

export function storeTokens(accessToken, refreshToken) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearStoredTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// Web Locks serialize across every tab of this origin; browsers without
// them fall back to the old unlocked behavior.
const withLock = (fn) => (navigator.locks?.request ? navigator.locks.request(LOCK_NAME, fn) : fn());

/**
 * A usable { accessToken, refreshToken } pair: the stored one if its access
 * token still has a few minutes left (typically another tab just refreshed),
 * otherwise a new one from the server, stored for the other tabs. Throws if
 * there's no session or the refresh is rejected.
 */
export function getFreshTokens() {
  return withLock(async () => {
    // Read inside the lock: another tab may have rotated it while we waited.
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) throw new Error('No stored session');
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (accessToken && msLeft(accessToken) > MIN_REMAINING_MS) return { accessToken, refreshToken };

    const res = await apiClient.post('/api/auth/refresh', { refreshToken });
    storeTokens(res.accessToken, res.refreshToken);
    return res;
  });
}
