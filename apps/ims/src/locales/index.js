// IMS text, one file per section so pages can be translated independently.
// Each section exports { en, km }; translations.<locale>.<section>.<key>.
// English is the source of truth -- missing km keys fall back to it (i18n/translate.js).
import common from './common';
import shell from './shell';
import products from './products';
import importExport from './importExport';
import stores from './stores';
import suppliers from './suppliers';
import categories from './categories';
import staff from './staff';
import terminals from './terminals';
import transfers from './transfers';
import sales from './sales';
import reports from './reports';
import reconciliation from './reconciliation';
import settings from './settings';

const sections = {
  common,
  shell,
  products,
  importExport,
  stores,
  suppliers,
  categories,
  staff,
  terminals,
  transfers,
  sales,
  reports,
  reconciliation,
  settings,
};

const pick = (locale) => Object.fromEntries(Object.entries(sections).map(([name, s]) => [name, s[locale] || {}]));

export const translations = {
  en: pick('en'),
  km: pick('km'),
};
