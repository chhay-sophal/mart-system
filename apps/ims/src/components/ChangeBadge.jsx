/**
 * "▲ 12.3% vs previous period" under a figure: green up, red down. Up counts
 * as good, which holds for every figure it's used with (revenue, profit,
 * orders, average order). "—" when there's nothing to compare with.
 */
export default function ChangeBadge({ current, previous, label }) {
  if (!previous) {
    return current ? <p className="text-xs mt-1 text-slate-400 dark:text-slate-500">— {label}</p> : null;
  }
  const change = (current - previous) / Math.abs(previous);
  const flat = Math.abs(change) < 0.0005;
  const tone = flat ? 'text-slate-500 dark:text-slate-400' : change > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <p className={`text-xs mt-1 tabular-nums ${tone}`}>
      {flat ? '=' : change > 0 ? '▲' : '▼'} {Math.abs(change * 100).toFixed(1)}%{' '}
      <span className="text-slate-400 dark:text-slate-500">{label}</span>
    </p>
  );
}
