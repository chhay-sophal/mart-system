import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, LOCALES, dictionaryFor, setActiveLocale } from './translate';

const STORAGE_KEY = 'ims-locale';
const LocaleContext = createContext(null);

function storedLocale() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LOCALES.includes(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * The IMS display language ('en' | 'km'), remembered per browser. Pages read
 * their text from useLocale().t -- the dictionary for the current language,
 * falling back to English for anything not translated yet.
 */
export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState(storedLocale);

  // Keep non-React modules (lib/*.js) on the same language as the UI.
  setActiveLocale(locale);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Private window or blocked storage: the choice just isn't remembered.
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t: dictionaryFor(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
