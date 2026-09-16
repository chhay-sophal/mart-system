import { ApiClient } from '@mart-system/api-client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

/**
 * The AuthContext owns the actual token values; this ref is just a mutable
 * box ApiClient reads from on every request so we don't need to recreate the
 * client (and lose in-flight closures) every time a token rotates.
 */
export const accessTokenRef = { current: null };

export const apiClient = new ApiClient({
  baseUrl: BASE_URL,
  getAuthToken: () => accessTokenRef.current,
  onUnauthorized: () => {
    window.dispatchEvent(new CustomEvent('ims:unauthorized'));
  },
});
