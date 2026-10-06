import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A searchable dropdown for picking one of many options by typing part of
 * its label -- a plain <select> doesn't let you filter, which gets painful
 * once there are more than a handful of entries (e.g. a supplier list).
 *
 * The panel renders through a portal, positioned from the trigger button's
 * own screen rect, the same way ProductsPage's column-filter dropdowns do --
 * it's used inside a scrolling modal, where a normal absolutely-positioned
 * child could get clipped by the modal's own overflow-y-auto.
 */
export default function SearchableSelect({ value, onChange, options, emptyLabel = 'None', placeholder = 'Select…' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const updatePos = () => {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen]);

  // Closes on an outside click or Escape -- same pattern as the column-filter
  // dropdowns, but must also exclude the trigger button itself (clicking it
  // again toggles isOpen on its own onClick; without this the outside-click
  // handler would immediately re-close what that click just opened).
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  function toggleOpen() {
    setIsOpen((v) => {
      if (!v) setQuery('');
      return !v;
    });
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  function selectValue(v) {
    onChange(v);
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        className="w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm text-left bg-white dark:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400 dark:text-slate-500'}`}>
          {selected ? selected.label : value === '' ? emptyLabel : placeholder}
        </span>
        <span className="text-slate-400 dark:text-slate-500 text-[10px] flex-shrink-0">▾</span>
      </button>

      {isOpen && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 bg-white dark:bg-slate-800 border border-[var(--border)] rounded-lg shadow-lg overflow-hidden"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full px-3 py-2 text-sm border-b border-[var(--border)] outline-none bg-transparent text-slate-900 dark:text-white"
          />
          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => selectValue('')}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer ${
                value === '' ? 'font-medium text-[var(--accent)]' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {emptyLabel}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">No matches.</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => selectValue(o.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer ${
                    o.value === value ? 'font-medium text-[var(--accent)]' : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
