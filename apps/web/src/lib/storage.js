// localStorage can be unavailable (private mode, blocked site data) — the
// storefront still works, it just forgets the branch and cart on reload.
export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignored on purpose; see above.
  }
}
