import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
export default function FilterableHeader({ col, label, sort, onSort, isOpen, onToggleFilter, hasActiveFilter, panelRef, children }) {
  const active = sort.col === col;
  const buttonRef = useRef(null);
  // Screen coordinates for the portaled panel below, in state (not read at
  // render time) so a resize/scroll while open re-renders it at the right spot.
  const [pos, setPos] = useState(null);

  // The table's wrapper div needs overflow-hidden to clip its background to
  // the rounded corners, which would also clip this dropdown if it rendered
  // as a normal descendant -- a short table (few rows) left no room below.
  // Rendering it through a portal, positioned from the button's own
  // viewport rect, escapes that clipping entirely.
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const updatePos = () => {
      const r = buttonRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen]);

  return (
    <th className="px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => onSort(col)} className="font-medium hover:text-slate-800 dark:hover:text-slate-100 select-none">
          {label}
          <span className="ml-1 text-[var(--accent)]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
        <button
          ref={buttonRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFilter(col); }}
          aria-label={`Filter ${label}`}
          aria-expanded={isOpen}
          className={`p-1 rounded-md transition-colors cursor-pointer ${
            hasActiveFilter ? 'bg-indigo-50 dark:bg-indigo-950/40 text-[var(--accent)]' : 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <FilterIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {isOpen && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 min-w-[200px] bg-white dark:bg-slate-800 border border-[var(--border)] rounded-lg shadow-lg p-3 font-normal"
        >
          {children}
        </div>,
        document.body
      )}
    </th>
  );
}
