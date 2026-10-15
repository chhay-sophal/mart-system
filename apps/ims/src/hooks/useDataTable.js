import { useMemo, useState } from 'react';

/**
 * Filter + sort state for a <DataTable>, driven entirely by its column
 * definitions. Kept separate from the component so a page can show its own
 * row count / "Clear filters" button, or paginate `visible`, outside the table.
 *
 * A column is { key, label, header?, render?, className?, cellClassName?,
 * sortValue?, compare?, filter? }:
 * - sortValue(row) makes the column sortable by that value; compare(a, b)
 *   overrides how two rows compare (it also makes the column sortable).
 * - header replaces the label/sort/filter header with arbitrary content.
 * - filter is one of (value(row) defaults to sortValue, then row[key]):
 *   { type: 'text', placeholder? }  case-insensitive "contains".
 *   { type: 'select', options: [{ value, label }], defaultValue?, match?(row, v) }
 *     exact match on value(row) (or match), with an "All" option prepended
 *     unless defaultValue is set -- then options must include its own "all".
 *   { type: 'numberRange', minPlaceholder?, maxPlaceholder? }  inclusive.
 *   { type: 'dateRange' }  'YYYY-MM-DD' bounds, local time, inclusive of the
 *     whole day; a null value never matches a set bound.
 *   { type: 'custom', empty, match(row, v), render({ value, onChange }), describe?(v) }
 * A filter counts as active whenever its value differs from its empty value.
 * Each type's describe() gives the short text for its active-filter chip
 * (components/FilterChips.jsx); a custom filter supplies its own, or its chip
 * shows just the column label.
 */

const ALL = 'all';
const norm = (value) => String(value ?? '').trim().toLowerCase();
const rowValue = (col, row) => (col.filter?.value ?? col.sortValue ?? ((r) => r[col.key]))(row);

function inDateRange(value, from, to) {
  if (!from && !to) return true;
  if (value == null) return false;
  const d = new Date(value);
  if (from && d < new Date(`${from}T00:00:00`)) return false;
  if (to && d > new Date(`${to}T23:59:59.999`)) return false;
  return true;
}

/** "5 – 10", "≥ 5" or "≤ 10" -- the chip text for a range with either bound blank. */
export function rangeText(min, max) {
  if (min !== '' && max !== '') return `${min} – ${max}`;
  return min !== '' ? `≥ ${min}` : `≤ ${max}`;
}

export const FILTER_TYPES = {
  text: {
    empty: () => '',
    match: (col, row, v) => norm(rowValue(col, row)).includes(norm(v)),
    describe: (filter, v) => v.trim(),
  },
  select: {
    empty: (filter) => filter.defaultValue ?? ALL,
    match: (col, row, v) => v === ALL || (col.filter.match ? col.filter.match(row, v) : String(rowValue(col, row)) === v),
    describe: (filter, v) => filter.options.find((o) => o.value === v)?.label ?? v,
  },
  numberRange: {
    empty: () => ({ min: '', max: '' }),
    match: (col, row, { min, max }) => {
      const n = Number(rowValue(col, row));
      return (min === '' || n >= Number(min)) && (max === '' || n <= Number(max));
    },
    describe: (filter, { min, max }) => rangeText(min, max),
  },
  dateRange: {
    empty: () => ({ from: '', to: '' }),
    match: (col, row, { from, to }) => inDateRange(rowValue(col, row), from, to),
    describe: (filter, { from, to }) => rangeText(from, to),
  },
  custom: {
    empty: (filter) => filter.empty,
    match: (col, row, v) => col.filter.match(row, v),
    describe: (filter, v) => filter.describe?.(v) ?? '',
  },
};

const emptyOf = (filter) => FILTER_TYPES[filter.type].empty(filter);
const isEmpty = (filter, value) => JSON.stringify(value) === JSON.stringify(emptyOf(filter));

// Nulls sort last either way, so "no email" rows don't crowd the top.
export function compareValues(a, b) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b));
  return Number(a) - Number(b);
}

function comparatorOf(col) {
  if (!col) return null;
  if (col.compare) return col.compare;
  if (col.sortValue) return (a, b) => compareValues(col.sortValue(a), col.sortValue(b));
  return null;
}

export function useDataTable({ rows, columns, initialSort }) {
  const filterable = useMemo(() => columns.filter((c) => c.filter), [columns]);
  const emptyFilters = useMemo(() => Object.fromEntries(filterable.map((c) => [c.key, emptyOf(c.filter)])), [filterable]);
  const [filters, setFilters] = useState(emptyFilters);
  const [sort, setSort] = useState(initialSort);
  const valueOf = (c) => filters[c.key] ?? emptyOf(c.filter);

  const visible = useMemo(() => {
    // Always matched, even at the empty value: a select's default may itself
    // narrow the rows (e.g. "active" hides archived ones).
    const filtered = rows.filter((row) =>
      filterable.every((c) => FILTER_TYPES[c.filter.type].match(c, row, filters[c.key] ?? emptyOf(c.filter)))
    );
    const primary = comparatorOf(columns.find((c) => c.key === sort.col));
    if (!primary) return filtered;
    // Ties fall back to the initial sort column, so the order stays stable.
    const tieBreak = comparatorOf(columns.find((c) => c.key === initialSort.col));
    const sign = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => sign * primary(a, b) || (tieBreak ? tieBreak(a, b) : 0));
  }, [rows, columns, filterable, filters, sort, initialSort.col]);

  return {
    columns,
    visible,
    total: rows.length,
    filters,
    emptyFilters,
    setFilter: (key, value) => setFilters((prev) => ({ ...prev, [key]: value })),
    clearFilters: () => setFilters(emptyFilters),
    filterCount: filterable.filter((c) => !isEmpty(c.filter, valueOf(c))).length,
    isFilterActive: (key) => {
      const col = filterable.find((c) => c.key === key);
      return Boolean(col) && !isEmpty(col.filter, valueOf(col));
    },
    sort,
    toggleSort: (col) =>
      setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })),
  };
}
