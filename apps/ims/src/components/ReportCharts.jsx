import { useLayoutEffect, useRef, useState } from 'react';
import { inMainCurrency } from '../lib/orderTotals';

// Charts for the Reports page. Plain SVG/HTML, no chart library: the series
// colors are the --series-* tokens in index.css (revenue, then profit).

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// A 1/2/2.5/5 × 10^n step, so axis ticks land on round numbers.
function niceStep(raw) {
  if (raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

/** Short axis label: "$1.2k", "850k ៛", "1.5M ៛". */
function fmtCompact(mainCurrency, n) {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const short = a >= 1e6 ? `${+(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(1)}k` : `${+a.toFixed(mainCurrency === 'KHR' ? 0 : 2)}`;
  return mainCurrency === 'KHR' ? `${sign}${short} ៛` : `${sign}$${short}`;
}

// A bar from the baseline to `yEnd`, with only its data end rounded.
function barPath(x, yBase, yEnd, w) {
  const h = Math.abs(yBase - yEnd);
  const r = Math.min(4, w / 2, h);
  const dir = yEnd < yBase ? 1 : -1; // 1 = grows up
  const yr = yEnd + dir * r;
  return `M${x},${yBase} L${x},${yr} Q${x},${yEnd} ${x + r},${yEnd} L${x + w - r},${yEnd} Q${x + w},${yEnd} ${x + w},${yr} L${x + w},${yBase} Z`;
}

function Swatch({ color }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />;
}

const HEIGHT = 240;
const M = { top: 12, right: 8, bottom: 24, left: 56 };

/** Revenue and profit side by side per time bucket, on one money axis. */
export function SalesOverTimeChart({ buckets, previous = null, unit, mainCurrency, locale, labels }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const intlLocale = locale === 'km' ? 'km-KH' : 'en-US';
  const dayFmt = new Intl.DateTimeFormat(intlLocale, { month: 'short', day: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat(intlLocale, { month: 'short', year: 'numeric' });
  const label = (b) => (unit === 'hour' ? `${b.key}:00` : unit === 'day' ? dayFmt.format(b.date) : monthFmt.format(b.date));

  const khr = mainCurrency === 'KHR';
  const revenueOf = (b) => (khr ? b.revenueKhr : b.revenue);
  const profitOf = (b) => (khr ? b.profitKhr : b.profit);
  const series = [
    { key: 'revenue', label: labels.revenue, color: 'var(--series-1)', value: revenueOf },
    { key: 'profit', label: labels.profit, color: 'var(--series-2)', value: profitOf },
  ];

  const hasSales = buckets.some((b) => b.orderCount > 0);
  // The previous period's revenue, one point per bucket (null where it has
  // none), drawn as a neutral dashed baseline rather than another series.
  const prevRevenue = previous ? previous.map((b) => (b ? revenueOf(b) : null)) : null;
  const values = [...buckets.flatMap((b) => [revenueOf(b), profitOf(b)]), ...(prevRevenue ?? []).filter((v) => v !== null)];
  const step = niceStep((Math.max(0, ...values) - Math.min(0, ...values)) / 4);
  const yMax = Math.max(step, Math.ceil(Math.max(0, ...values) / step) * step);
  const yMin = Math.floor(Math.min(0, ...values) / step) * step;
  const ticks = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const y = (v) => M.top + ((yMax - v) / (yMax - yMin)) * plotH;
  const band = buckets.length ? plotW / buckets.length : 0;
  const groupW = Math.min(band * 0.72, 44);
  const barW = Math.max(1, (groupW - 2) / 2); // 2px gap between the pair
  // Skip x labels so neighbours never collide (~56px each).
  const labelEvery = Math.max(1, Math.ceil(56 / Math.max(band, 1)));

  const hovered = hover !== null ? buckets[hover] : null;
  const hoverX = hover !== null ? M.left + hover * band + band / 2 : 0;

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mb-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <Swatch color={s.color} />
            {s.label}
          </span>
        ))}
        {prevRevenue && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-slate-400 dark:border-slate-500" aria-hidden="true" />
            {labels.previous}
          </span>
        )}
      </div>
      <div ref={ref} className="relative" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={labels.title} onMouseLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray={v === 0 ? undefined : '2 3'} />
                <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-slate-400 dark:fill-slate-500 text-[11px] tabular-nums">
                  {fmtCompact(mainCurrency, v)}
                </text>
              </g>
            ))}
            {hover !== null && <rect x={M.left + hover * band} y={M.top} width={band} height={plotH} className="fill-slate-100 dark:fill-slate-700/50" />}
            {buckets.map((b, i) => {
              const x0 = M.left + i * band + (band - groupW) / 2;
              return (
                <g key={b.key}>
                  {series.map((s, si) => {
                    const v = s.value(b);
                    if (Math.abs(y(0) - y(v)) < 0.5) return null;
                    return <path key={s.key} d={barPath(x0 + si * (barW + 2), y(0), y(v), barW)} fill={s.color} />;
                  })}
                  {i % labelEvery === 0 && (
                    <text x={M.left + i * band + band / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-slate-400 dark:fill-slate-500 text-[11px]">
                      {label(b)}
                    </text>
                  )}
                  {/* Hit target: the whole band, not just the thin bars (drawn last, on top). */}
                  <rect
                    x={M.left + i * band}
                    y={M.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onClick={() => setHover(i)}
                  />
                </g>
              );
            })}
            {prevRevenue && (
              <polyline
                points={prevRevenue
                  .map((v, i) => (v === null ? null : `${M.left + i * band + band / 2},${y(v)}`))
                  .filter(Boolean)
                  .join(' ')}
                fill="none"
                strokeWidth={2}
                strokeDasharray="4 3"
                strokeLinejoin="round"
                className="stroke-slate-400 dark:stroke-slate-500 pointer-events-none"
              />
            )}
          </svg>
        )}
        {!hasSales && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500 pointer-events-none">{labels.empty}</p>
        )}
        {hovered && (
          <div
            className="absolute top-0 z-10 pointer-events-none bg-white dark:bg-slate-900 border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs min-w-40"
            style={{
              left: Math.min(Math.max(hoverX, 80), width - 80),
              transform: 'translateX(-50%)',
            }}
          >
            <p className="font-medium text-[var(--text-h)] mb-1">{label(hovered)}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 justify-between">
                <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                  <Swatch color={s.color} />
                  {s.label}
                </span>
                <span className="tabular-nums text-[var(--text-h)]">
                  {inMainCurrency(mainCurrency, hovered[s.key], hovered[`${s.key}Khr`]).primary}
                </span>
              </p>
            ))}
            <p className="flex justify-between text-slate-500 dark:text-slate-400 mt-0.5">
              <span>{labels.orders}</span>
              <span className="tabular-nums text-[var(--text-h)]">{hovered.orderCount}</span>
            </p>
            {previous?.[hover] && (
              <p className="flex justify-between gap-3 text-slate-500 dark:text-slate-400 mt-0.5">
                <span>{labels.previous}</span>
                <span className="tabular-nums text-[var(--text-h)]">
                  {inMainCurrency(mainCurrency, previous[hover].revenue, previous[hover].revenueKhr).primary}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The ten best sellers as horizontal bars, by revenue or by quantity. */
export function TopProductsChart({ products, mainCurrency, labels }) {
  const [metric, setMetric] = useState('revenue');
  const valueOf = (p) => (metric === 'revenue' ? p.revenue : p.totalQty);
  const top = [...products].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 10);
  const max = top.length ? valueOf(top[0]) : 0;
  const money = (p) => inMainCurrency(mainCurrency, p.revenue, p.revenueKhr).primary;

  return (
    <div>
      <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs w-fit mb-3">
        {[
          { key: 'revenue', label: labels.revenue },
          { key: 'qty', label: labels.qty },
        ].map((m, i) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-2.5 h-7 cursor-pointer ${i > 0 ? 'border-l border-[var(--border)]' : ''} ${
              metric === m.key ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{labels.empty}</p>
      ) : (
        <ol className="space-y-2">
          {top.map((p) => (
            <li key={p.productId} className="text-xs">
              <div className="flex justify-between gap-2 mb-1">
                <span className="truncate text-[var(--text-h)]" title={p.name}>{p.name}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-[var(--text-h)]">{metric === 'revenue' ? money(p) : p.totalQty}</span>
                  <span className="text-slate-400 dark:text-slate-500"> · {metric === 'revenue' ? `${p.totalQty} ${labels.units}` : money(p)}</span>
                </span>
              </div>
              <div className="h-2">
                <div
                  className="h-full rounded-r-[4px] bg-[var(--series-1)]"
                  style={{ width: `${max > 0 ? Math.max(1, (valueOf(p) / max) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Each payment method keeps its own color whatever its rank, in the enum's
// order; anything unknown falls back to the gray.
const METHOD_COLORS = {
  CASH: 'var(--series-3)',
  KHQR: 'var(--series-4)',
  STATIC_QR: 'var(--series-5)',
  CARD: 'var(--series-6)',
};

// One donut slice from angle a0 to a1 (radians, clockwise from 12 o'clock).
function slicePath(cx, cy, r, ri, a0, a1) {
  const pt = (rad, a) => `${cx + rad * Math.sin(a)},${cy - rad * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(r, a0)} A${r},${r} 0 ${large} 1 ${pt(r, a1)} L${pt(ri, a1)} A${ri},${ri} 0 ${large} 0 ${pt(ri, a0)} Z`;
}

/** Revenue by payment method as a donut, the total (or hovered slice) in the middle. */
export function PaymentMethodsChart({ methods, mainCurrency, labels }) {
  const [hover, setHover] = useState(null);
  const total = methods.reduce((sum, m) => sum + m.total, 0);
  const totalKhr = methods.reduce((sum, m) => sum + m.totalKhr, 0);
  const orders = methods.reduce((sum, m) => sum + m.count, 0);
  const money = (usd, khr) => inMainCurrency(mainCurrency, usd, khr).primary;

  if (methods.length === 0 || total <= 0) return <p className="text-sm text-slate-400 dark:text-slate-500">{labels.empty}</p>;

  const size = 168;
  const c = size / 2;
  const r = c - 2;
  const ri = r * 0.62;
  const slices = [];
  for (const m of methods) {
    const a0 = slices.length ? slices[slices.length - 1].a1 : 0;
    slices.push({ ...m, a0, a1: a0 + (m.total / total) * 2 * Math.PI });
  }
  const focused = hover ? methods.find((m) => m.paymentMethod === hover) : null;

  return (
    <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }} onMouseLeave={() => setHover(null)}>
        <svg width={size} height={size} role="img" aria-label={labels.title}>
          {slices.map((s) =>
            slices.length === 1 ? (
              <circle key={s.paymentMethod} cx={c} cy={c} r={(r + ri) / 2} fill="none" strokeWidth={r - ri} stroke={METHOD_COLORS[s.paymentMethod] ?? 'var(--series-6)'} />
            ) : (
              <path
                key={s.paymentMethod}
                d={slicePath(c, c, r, ri, s.a0, s.a1)}
                fill={METHOD_COLORS[s.paymentMethod] ?? 'var(--series-6)'}
                // 2px surface-colored gap between slices.
                className="stroke-white dark:stroke-slate-800 cursor-pointer transition-opacity"
                strokeWidth={2}
                opacity={hover && hover !== s.paymentMethod ? 0.35 : 1}
                onMouseEnter={() => setHover(s.paymentMethod)}
                onClick={() => setHover(s.paymentMethod)}
              />
            )
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{focused ? labels.method(focused.paymentMethod) : labels.total}</span>
          <span className="text-sm font-semibold text-[var(--text-h)] tabular-nums">
            {focused ? money(focused.total, focused.totalKhr) : money(total, totalKhr)}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
            {focused ? `${((focused.total / total) * 100).toFixed(1)}%` : `${orders} ${labels.orders}`}
          </span>
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {methods.map((m) => (
          <li
            key={m.paymentMethod}
            onMouseEnter={() => setHover(m.paymentMethod)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 ${hover === m.paymentMethod ? 'bg-slate-50 dark:bg-slate-700/50' : ''}`}
          >
            <Swatch color={METHOD_COLORS[m.paymentMethod] ?? 'var(--series-6)'} />
            <span className="flex-1 truncate">{labels.method(m.paymentMethod)}</span>
            <span className="tabular-nums text-[var(--text-h)]">{money(m.total, m.totalKhr)}</span>
            <span className="tabular-nums text-xs text-slate-400 dark:text-slate-500 w-20 text-right">
              {((m.total / total) * 100).toFixed(1)}% ({m.count})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Row backgrounds as solid colors, so the profit bar's gap (a ring in the
// row's own color) blends in whether the row is idle, hovered or selected.
// The dark hover/selected values are the translucent tints flattened onto
// the slate-800 card.
const ROW_IDLE = '[--row-bg:#ffffff] dark:[--row-bg:#1e293b] hover:[--row-bg:#f8fafc] dark:hover:[--row-bg:#283548]';
const ROW_ACTIVE = '[--row-bg:#edecfc] dark:[--row-bg:#2a3066]';

/**
 * Revenue per category as horizontal bars, each with its profit drawn as a
 * thinner bar inside, so high-volume, low-margin categories stand out. One
 * hue pair for every row: there can be more categories than a palette has
 * distinguishable colors, and the name labels each bar anyway. Clicking a
 * category calls onSelect(key); the active one is highlighted.
 */
export function CategoryBreakdownChart({ categories, totalRevenue, mainCurrency, activeKey, onSelect, labels }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 8;
  const sorted = [...categories].sort((a, b) => b.revenue - a.revenue);
  const shown = showAll ? sorted : sorted.slice(0, LIMIT);
  const max = sorted.length ? sorted[0].revenue : 0;
  const money = (usd, khr) => inMainCurrency(mainCurrency, usd, khr).primary;
  const pct = (n) => `${Math.max(0, n * 100).toFixed(1)}%`;

  if (sorted.length === 0) return <p className="text-sm text-slate-400 dark:text-slate-500">{labels.empty}</p>;

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mb-3">
        <span className="inline-flex items-center gap-1.5">
          <Swatch color="var(--series-1)" />
          {labels.revenue}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Swatch color="var(--series-2)" />
          {labels.profit}
        </span>
      </div>
      <ul className="space-y-1">
        {shown.map((c) => {
          const active = activeKey === c.key;
          const margin = c.profit !== null && c.uncostedQty === 0 && c.revenue > 0 ? c.profit / c.revenue : null;
          return (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => onSelect(c.key)}
                aria-pressed={active}
                title={labels.filterHint}
                className={`w-full text-left text-xs rounded-md px-2 py-1.5 -mx-2 cursor-pointer bg-[var(--row-bg)] ${active ? ROW_ACTIVE : ROW_IDLE}`}
              >
                <div className="flex justify-between gap-2 mb-1">
                  <span className={`truncate ${c.key === '' ? 'italic text-slate-500 dark:text-slate-400' : 'text-[var(--text-h)]'} ${active ? 'font-medium' : ''}`}>
                    {c.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="text-[var(--text-h)]">{money(c.revenue, c.revenueKhr)}</span>
                    <span className="text-slate-400 dark:text-slate-500"> · {pct(totalRevenue > 0 ? c.revenue / totalRevenue : 0)}</span>
                  </span>
                </div>
                <div className="relative h-4">
                  <div
                    className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--series-1)]"
                    style={{ width: `${max > 0 ? Math.max(1, (c.revenue / max) * 100) : 0}%` }}
                  />
                  {c.profit > 0 && (
                    <div
                      className="absolute top-[5px] h-1.5 left-0 rounded-r-[3px] bg-[var(--series-2)] ring-2 ring-[var(--row-bg)]"
                      style={{ width: `${max > 0 ? Math.max(1, (Math.min(c.profit, c.revenue) / max) * 100) : 0}%` }}
                    />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                  {labels.meta(c.productCount, c.qty)}
                  {' · '}
                  {c.profit === null ? (
                    <span className="text-amber-600 dark:text-amber-400">{labels.noCost}</span>
                  ) : (
                    <span title={c.uncostedQty > 0 ? labels.partlyUncosted(c.uncostedQty) : undefined}>
                      {labels.profit}{' '}
                      <span className={c.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-h)]'}>{money(c.profit, c.profitKhr)}</span>
                      {c.uncostedQty > 0 && <span className="text-amber-600 dark:text-amber-400">*</span>}
                      {margin !== null && ` (${(margin * 100).toFixed(1)}%)`}
                    </span>
                  )}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      {sorted.length > LIMIT && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-[var(--accent)] font-medium cursor-pointer">
          {showAll ? labels.showLess : labels.showAll(sorted.length)}
        </button>
      )}
    </div>
  );
}
