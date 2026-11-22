import { useState } from 'react';

/**
 * Client-side paging over an already filtered + sorted list (pair with
 * components/Pagination.jsx):
 *
 *   const pager = usePagination(table.visible, 50, JSON.stringify([search.query, table.sort, table.filters]));
 *   <DataTable rows={pager.pageRows} ... />
 *   <Pagination pager={pager} />
 *
 * `resetKey` is any string describing what's listed; whenever it changes
 * (new search, sort, filters, range...) the page goes back to 1, so a
 * narrower list never leaves you on a page past its end. The page is also
 * clamped to the last one, for lists that shrink without a key change.
 */
export function usePagination(rows, pageSize, resetKey = '') {
  const [state, setState] = useState({ page: 1, key: resetKey });
  // Reset during render rather than in an effect, so the stale page is
  // never rendered first.
  if (state.key !== resetKey) setState({ page: 1, key: resetKey });

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(state.key === resetKey ? state.page : 1, pageCount);
  return {
    page,
    pageCount,
    pageSize,
    total,
    pageRows: rows.slice((page - 1) * pageSize, page * pageSize),
    setPage: (next) => setState({ page: Math.max(1, Math.min(next, pageCount)), key: resetKey }),
  };
}
