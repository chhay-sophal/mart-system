import { useDeferredValue, useMemo, useState } from 'react';

const norm = (value) => String(value ?? '').trim().toLowerCase();

/**
 * Free-text search over a list, for a page's top search bar (pair with
 * components/SearchInput.jsx). A row matches when any of `fields` contains
 * the query, case-insensitively. Each field is a function of the row that
 * returns a value or an array of values (e.g. every line item's name).
 *
 *   const search = useSearch(products, [(p) => p.name, (p) => p.barcode]);
 *   <SearchInput value={search.query} onChange={search.setQuery} ... />
 *   ...feed search.results into useDataTable.
 *
 * Filtering runs on a deferred copy of the query, so typing stays responsive
 * on long lists.
 */
export function useSearch(rows, fields) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    const q = norm(deferred);
    if (!q) return rows;
    return rows.filter((row) => fields.some((field) => [field(row)].flat().some((v) => norm(v).includes(q))));
    // `fields` is usually an inline array, so it's deliberately left out of
    // the deps: it only describes which columns to read, not data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, deferred]);

  return { query, setQuery, clear: () => setQuery(''), isActive: query.trim() !== '', results };
}
