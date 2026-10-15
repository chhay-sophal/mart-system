import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt } from '../i18n/translate';
import { useAnchoredPosition } from '../hooks/useAnchoredPosition';

export const filterInput = 'w-full border border-[var(--border)] rounded-md px-3 h-9 text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200';

function FilterIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16l-6.5 7.5V19l-3-1.5v-5L4 5z" />
    </svg>
  );
}

// Column header: clicking the label text sorts (unchanged); a separate
// filter button on the right opens a dropdown with that column's filter
// controls. Pairs with the useColumnFilter hook, which owns isOpen/panelRef.
// With no children there's no filter button; with no onSort the label is
// plain text -- so one header covers sort-only and label-only columns too.
export default function FilterableHeader({ col, label, sort, onSort, isOpen, onToggleFilter, hasActiveFilter, panelRef, className = '', children }) {
  const { t } = useLocale();
  const active = sort?.col === col;
  const buttonRef = useRef(null);
  // The table's wrapper div clips its overflow (rounded corners, sideways
  // scroll), which would also clip this dropdown if it rendered as a normal
  // descendant -- so it's portaled out and positioned from the button,
  // kept on screen (right-aligned with the button when there's room).
  const panelStyle = useAnchoredPosition(buttonRef, panelRef, isOpen, { prefer: 'end' });

  // Matches the plain SortTh's own className convention (e.g. "text-center",
  // "text-right") so a numeric column's filter icon lands on the same side as
  // its header label, instead of always drifting to the far right.
  const justify = className.includes('text-right') ? 'justify-end' : className.includes('text-center') ? 'justify-center' : 'justify-between';

  return (
    <th className={`px-4 py-2 ${className}`}>
      <div className={`flex items-center gap-2 ${justify}`}>
        {onSort ? (
          <button type="button" onClick={() => onSort(col)} className="inline-flex items-center font-medium hover:text-slate-800 dark:hover:text-slate-100 select-none cursor-pointer">
            {label}
            {active ? (
              sort.dir === 'asc' ? <ChevronUp size={12} className="ml-1 text-[var(--accent)]" /> : <ChevronDown size={12} className="ml-1 text-[var(--accent)]" />
            ) : (
              <ChevronsUpDown size={12} className="ml-1 text-slate-300 dark:text-slate-600" />
            )}
          </button>
        ) : (
          <span className="font-medium">{label}</span>
        )}
        {children && <button
          ref={buttonRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFilter(col); }}
          aria-label={fmt(t.common.filterColumn, { label })}
          aria-expanded={isOpen}
          className={`p-1 rounded-md transition-colors cursor-pointer ${
            hasActiveFilter ? 'bg-indigo-50 dark:bg-indigo-950/40 text-[var(--accent)]' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <FilterIcon className="w-3.5 h-3.5" />
        </button>}
      </div>
      {children && isOpen && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className="z-50 min-w-[200px] bg-white dark:bg-slate-800 border border-[var(--border)] rounded-lg shadow-lg p-3 font-normal"
        >
          {children}
        </div>,
        document.body
      )}
    </th>
  );
}
