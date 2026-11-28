import { useState } from 'react';
import { inMainCurrency } from '../lib/orderTotals';

// The Analytics page's busiest-hours heatmap and product movers.

const segmented = (active) =>
  `px-2.5 h-7 cursor-pointer ${active ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium' : 'text-slate-500 dark:text-slate-400'}`;

/**
 * Day of week (rows, Monday first) × hour of day (columns) for the whole
 * range, by orders or revenue. One hue, stronger where busier; the value of
 * each cell is in its tooltip, so colour never carries it alone.
 */
export function BusiestHoursHeatmap({ heatmap, mainCurrency, labels }) {
  const [metric, setMetric] = useState('orders');
  const valueOf = (cell) => (metric === 'orders' ? cell.orders : mainCurrency === 'KHR' ? cell.revenueKhr : cell.revenue);
  const money = (cell) => inMainCurrency(mainCurrency, cell.revenue, cell.revenueKhr).primary;

  // Usual trading hours, widened to any hour that had a sale.
  const busyHours = [];
  heatmap.forEach((row) => row.forEach((cell, hour) => cell.orders > 0 && busyHours.push(hour)));
  const start = Math.min(7, ...busyHours);
  const end = Math.max(21, ...busyHours);
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const max = Math.max(0, ...heatmap.flat().map(valueOf));

  if (max === 0) return <p className="text-sm text-slate-400 dark:text-slate-500">{labels.empty}</p>;

  return (
    <div>
      <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs w-fit mb-3">
        {[
          { key: 'orders', label: labels.orders },
          { key: 'revenue', label: labels.revenue },
        ].map((m, i) => (
          <button key={m.key} type="button" onClick={() => setMetric(m.key)} className={`${segmented(metric === m.key)} ${i > 0 ? 'border-l border-[var(--border)]' : ''}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }} role="grid" aria-label={labels.title}>
          <thead>
            <tr>
              <th />
              {hours.map((h) => (
                <th key={h} className="text-[10px] font-normal text-slate-400 dark:text-slate-500 w-7 text-center">
                  {h % 3 === 0 ? h : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.map((row, day) => (
              <tr key={day}>
                <th scope="row" className="text-[11px] font-normal text-slate-500 dark:text-slate-400 pr-2 text-left whitespace-nowrap">
                  {labels.weekdays[day]}
                </th>
                {hours.map((h) => {
                  const cell = row[h];
                  const value = valueOf(cell);
                  const tip = `${labels.weekdays[day]} ${h}:00 · ${cell.orders} ${labels.ordersWord} · ${money(cell)}`;
                  return (
                    <td
                      key={h}
                      title={tip}
                      aria-label={tip}
                      className={`h-6 w-7 rounded-[3px] ${value > 0 ? '' : 'bg-slate-100 dark:bg-slate-700/60'}`}
                      style={value > 0 ? { background: 'var(--series-1)', opacity: 0.15 + 0.85 * (value / max) } : undefined}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{labels.less}</span>
        {[0.15, 0.35, 0.6, 0.8, 1].map((o) => (
          <span key={o} className="inline-block w-4 h-3 rounded-[2px]" style={{ background: 'var(--series-1)', opacity: o }} aria-hidden="true" />
        ))}
        <span>{labels.more}</span>
      </div>
    </div>
  );
}

/**
 * Products rising, falling, and ones that stopped selling: the latest four
 * weeks against the four before, by revenue.
 */
export function ProductMovers({ products, mainCurrency, labels }) {
  const amount = (w) => (mainCurrency === 'KHR' ? w.revenueKhr : w.revenue);
  const money = (usd, khr) => inMainCurrency(mainCurrency, usd, khr).primary;
  const LIMIT = 8;

  const rising = products
    .filter((p) => amount(p.current) > amount(p.previous))
    .sort((a, b) => amount(b.current) - amount(b.previous) - (amount(a.current) - amount(a.previous)))
    .slice(0, LIMIT);
  const falling = products
    .filter((p) => amount(p.current) > 0 && amount(p.current) < amount(p.previous))
    .sort((a, b) => amount(b.previous) - amount(b.current) - (amount(a.previous) - amount(a.current)))
    .slice(0, LIMIT);
  const stopped = products
    .filter((p) => p.current.qty === 0 && p.previous.qty > 0)
    .sort((a, b) => amount(b.previous) - amount(a.previous))
    .slice(0, LIMIT);

  const change = (p) => {
    const diffUsd = p.current.revenue - p.previous.revenue;
    const diffKhr = p.current.revenueKhr - p.previous.revenueKhr;
    const ratio = amount(p.previous) > 0 ? (amount(p.current) / amount(p.previous) - 1) * 100 : null;
    const pct = ratio === null ? '' : ` (${ratio >= 0 ? '+' : ''}${ratio.toFixed(0)}%)`;
    return `${diffUsd >= 0 ? '+' : '−'}${money(Math.abs(diffUsd), Math.abs(diffKhr))}${pct}`;
  };

  const column = (title, list, tone, render) => (
    <div>
      <h3 className="text-xs font-semibold text-[var(--text-h)] mb-2">{title}</h3>
      {list.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{labels.none}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((p) => (
            <li key={p.productId} className="text-xs flex justify-between gap-2">
              <span className="truncate text-[var(--text-h)]" title={p.name}>{p.name}</span>
              <span className={`shrink-0 tabular-nums ${tone}`}>{render(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="grid sm:grid-cols-3 gap-6">
      {column(labels.rising, rising, 'text-emerald-600 dark:text-emerald-400', change)}
      {column(labels.falling, falling, 'text-red-600 dark:text-red-400', change)}
      {column(labels.stopped, stopped, 'text-slate-500 dark:text-slate-400', (p) =>
        labels.soldBefore.replace('{qty}', p.previous.qty).replace('{amount}', money(p.previous.revenue, p.previous.revenueKhr))
      )}
    </div>
  );
}
