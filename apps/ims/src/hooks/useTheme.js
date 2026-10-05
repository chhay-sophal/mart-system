import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ims-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark() {
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * 'system' | 'light' | 'dark', persisted and defaulting to 'system' (the OS
 * preference) on first visit. Applies/removes .dark on <html>, which
 * index.css's @custom-variant and dark CSS-variable overrides key off.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEY) ?? 'system');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && systemPrefersDark()));
    };
    apply();

    if (theme !== 'system') return;
    // Live-react to the OS theme changing while we're following it.
    const mql = window.matchMedia(DARK_QUERY);
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [theme]);

  return [theme, setTheme];
}
