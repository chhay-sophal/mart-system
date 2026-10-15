import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useAnchoredPosition } from '../hooks/useAnchoredPosition';
import ColumnFilter from './ColumnFilter.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

/**
 * A "Filter" button that opens a dropdown with every filter a useDataTable
 * table defines, one per column, labelled by its column. Edits there are a
 * draft: nothing reaches the table until "Apply" (or Enter in a field), and
 * closing the dropdown any other way discards them. "Clear" resets the draft
 * to empty. The button shows how many filters are applied.
 *
 *   <FilterButton table={table} />
 *
 * `only` limits the dropdown to those column keys, in that order. The
 * dropdown places itself (below/above, left/right edge) to stay on screen.
 */
export default function FilterButton({ table, only }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const panelStyle = useAnchoredPosition(buttonRef, panelRef, open);

  const columns = only
    ? only.map((key) => table.columns.find((c) => c.key === key)).filter((c) => c?.filter)
    : table.columns.filter((c) => c.filter);
  const activeCount = columns.filter((c) => table.isFilterActive(c.key)).length;

  useEffect(() => {
    if (!open) return;
    // The panel is portaled out of the button's subtree, so check both.
    const onPointerDown = (e) => {
      if (!buttonRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (columns.length === 0) return null;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const toggle = () => {
    // Each opening starts from what's currently applied.
    if (!open) setDraft(Object.fromEntries(columns.map((c) => [c.key, table.filters[c.key]])));
    setOpen((v) => !v);
  };
  const clearDraft = () => setDraft(Object.fromEntries(columns.map((c) => [c.key, table.emptyFilters[c.key]])));
  const draftIsEmpty = columns.every((c) => same(draft[c.key], table.emptyFilters[c.key]));
  // Per column via setFilter (not a bulk replace) so `only` leaves the other
  // columns alone, and any page wrapper around setFilter still runs.
  const apply = (e) => {
    e.preventDefault();
    columns.forEach((c) => {
      if (!same(draft[c.key], table.filters[c.key])) table.setFilter(c.key, draft[c.key]);
    });
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-medium cursor-pointer ${
          activeCount > 0
            ? 'border-[var(--accent)] text-[var(--accent)] bg-indigo-50 dark:bg-indigo-950/40'
            : 'border-[var(--border)] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'
        }`}
      >
        <SlidersHorizontal size={14} />
        {t.common.filter}
        {activeCount > 0 && (
          <span className="min-w-5 h-5 px-1.5 rounded-full bg-[var(--accent)] text-white text-xs leading-5 text-center">{activeCount}</span>
        )}
      </button>

      {open && createPortal(
        <form
          ref={panelRef}
          style={panelStyle}
          onSubmit={apply}
          className="z-50 w-72 bg-white dark:bg-slate-800 border border-[var(--border)] rounded-lg shadow-lg p-3 space-y-3"
        >
          {columns.map((col) => (
            <div key={col.key}>
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{col.label}</div>
              <ColumnFilter
                filter={col.filter}
                value={draft[col.key]}
                onChange={(v) => setDraft((prev) => ({ ...prev, [col.key]: v }))}
              />
            </div>
          ))}
          <div className="flex justify-end items-center gap-2 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={clearDraft}
              disabled={draftIsEmpty}
              className="text-sm font-medium px-3 h-8 text-slate-600 dark:text-slate-300 disabled:opacity-40 cursor-pointer disabled:cursor-default"
            >
              {t.common.clear}
            </button>
            <button type="submit" className="text-sm font-medium px-3 h-8 rounded-lg bg-[var(--accent)] text-white cursor-pointer">
              {t.common.apply}
            </button>
          </div>
        </form>,
        document.body
      )}
    </>
  );
}
