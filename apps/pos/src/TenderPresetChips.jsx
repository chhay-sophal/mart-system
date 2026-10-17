import { Plus } from "lucide-react";

/**
 * Quick-tap amounts under a cash tender field (Settings > General > Tendered
 * Amount Presets): the admin's customized list for this currency, plus a
 * dynamic "Exact" chip for the order's current total -- always shown first
 * when there's a total to pay, not something the admin configures.
 *
 * A regular preset stacks onto whatever's already entered, like adding
 * another bill -- except once the field already reads the grand total
 * exactly (e.g. the Exact chip was just tapped), the next tap starts over
 * with just that preset instead of overshooting the total. The Exact chip
 * itself always just replaces the field with the total.
 */
export default function TenderPresetChips({ amounts, exactAmount, exactLabel, currentValue, onPick, format }) {
  if (amounts.length === 0 && !(exactAmount > 0)) return null;
  const atTotal = Math.abs((currentValue || 0) - exactAmount) < 0.01;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {exactAmount > 0 && (
        <button
          type="button"
          onClick={() => onPick(exactAmount)}
          title={exactLabel}
          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer"
        >
          {format(exactAmount)}
        </button>
      )}
      {amounts.map((amount) => (
        <button
          key={amount}
          type="button"
          onClick={() => onPick(atTotal ? amount : Math.round(((currentValue || 0) + amount) * 100) / 100)}
          className="flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
        >
          <Plus size={10} />
          {format(amount)}
        </button>
      ))}
    </div>
  );
}
