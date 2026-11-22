// A page's filter choices (store, date range) that should survive leaving the
// page and coming back, or reloading the tab. Kept in sessionStorage, per tab
// and per page key, and cleared on sign-out (clearFilterState). Storage can
// be unavailable (private mode, blocked site data), so every access is
// guarded and the page simply falls back to its defaults.

const PREFIX = 'ims:filters:';

export function readFilterState(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeFilterState(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not remembered, but the page still works.
  }
}

/** Forgets every page's remembered filters (on sign-out: they're the last user's). */
export function clearFilterState() {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
