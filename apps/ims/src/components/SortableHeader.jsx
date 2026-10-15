import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

// Column header: clicking the label sorts by that column; with no onSort the
// label is plain text (e.g. an actions column).
export default function SortableHeader({ col, label, sort, onSort, className = '' }) {
  const active = sort?.col === col;
  // Follows the column's alignment class, so a numeric column's label sits on
  // the same side as its values.
  const justify = className.includes('text-right') ? 'justify-end' : className.includes('text-center') ? 'justify-center' : 'justify-start';

  return (
    <th className={`px-4 py-2 ${className}`}>
      <div className={`flex items-center ${justify}`}>
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
      </div>
    </th>
  );
}
