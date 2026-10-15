// Search, filter and sort helpers for IMS Products (issue #8). All in the
// browser on the cached product list, so results update as you type; the
// per-column filter/sort state itself lives in hooks/useDataTable.js.

import { getT } from '../i18n/translate';

// label is a getter, so it reads the current language each time it's shown.
const option = (value, key) => ({ value, get label() { return getT().products[key]; } });

export const STOCK_FILTERS = [
  option('all', 'stockAll'),
  option('low', 'stockLow'),
  option('out', 'stockOut'),
  option('negative', 'stockNegative'),
  option('in', 'stockIn'),
];

export const STATUS_FILTERS = [
  option('active', 'statusActive'),
  option('archived', 'statusArchived'),
  option('all', 'statusAll'),
];

/** The price a register sells at: the store's override if set, else the default. */
export const effectivePrice = (p) => Number(p.priceOverride ?? p.defaultPrice);

const norm = (value) => String(value ?? '').trim().toLowerCase();

/** A { mode: 'any' | 'missing', text } filter: "missing" means the value is blank. */
export function matchesTextOrMissing(value, { mode, text }) {
  const v = norm(value);
  return mode === 'missing' ? v === '' : v.includes(norm(text));
}

export function matchesStock(p, mode) {
  switch (mode) {
    case 'low':
      return p.stock <= p.lowStockThreshold;
    case 'out':
      return p.stock <= 0;
    case 'negative':
      return p.stock < 0;
    case 'in':
      return p.stock > 0;
    default:
      return true;
  }
}

export function matchesStatus(p, mode) {
  switch (mode) {
    case 'archived':
      return p.isDeleted;
    case 'all':
      return true;
    default: // 'active'
      return !p.isDeleted;
  }
}

/** Inclusive min/max ('' = unbounded); a non-numeric value never matches a set bound. */
export function inNumberRange(n, min, max) {
  if (min !== '' && !(n >= Number(min))) return false;
  if (max !== '' && !(n <= Number(max))) return false;
  return true;
}

// Prices sort within each currency (USD before KHR): without a rate, $1 and
// 4,100 ៛ can't be ranked against each other. Cost price is stored in the
// product's own currency too, so it uses the same ordering.
export const comparePriceBy = (amount) => (a, b) => a.currency.localeCompare(b.currency) * -1 || amount(a) - amount(b);
