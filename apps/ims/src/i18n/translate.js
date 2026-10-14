import { translations } from '../locales';

export const LOCALES = ['en', 'km'];
export const DEFAULT_LOCALE = 'en';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Untranslated keys fall back to English rather than rendering blank.
function withFallback(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    out[key] = isObject(value) && isObject(base[key]) ? withFallback(base[key], value) : value;
  }
  return out;
}

const dictionaries = Object.fromEntries(
  LOCALES.map((l) => [l, l === 'en' ? translations.en : withFallback(translations.en, translations[l])])
);

export const dictionaryFor = (locale) => dictionaries[locale] || dictionaries[DEFAULT_LOCALE];

let active = DEFAULT_LOCALE;
export const setActiveLocale = (locale) => {
  active = LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
};

/** The current language's dictionary, for code outside React (lib/*.js). */
export const getT = () => dictionaryFor(active);
export const getLocale = () => active;

/**
 * Fills {name} placeholders: fmt('{count} products', { count: 3 }).
 * Unknown placeholders are left as they are.
 */
export const fmt = (template, vars = {}) =>
  String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));

/** Picks the singular or plural form: plural(n, t.common.product, t.common.products). */
export const plural = (n, one, many) => (Number(n) === 1 ? one : many);
