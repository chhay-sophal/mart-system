// Baked in at build time (CI sets it from the SYNC_BACKEND_URL Actions
// variable). Pairing pre-fills it so admins only enter terminal credentials;
// Settings can still override it for staging or self-hosted backends.
// Empty when unset, which falls back to entering the URL by hand.
export const DEFAULT_SYNC_BACKEND_URL = (import.meta.env.VITE_SYNC_BACKEND_URL || '')
  .trim()
  .replace(/\/+$/, '');
