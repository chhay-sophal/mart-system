import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useStoreFilterState } from '../hooks/useFilterState';
import { usePersistentState } from '../hooks/usePersistentState';
import StoreSelect from '../components/StoreSelect.jsx';
import ChangeBadge from '../components/ChangeBadge.jsx';
import { SalesOverTimeChart } from '../components/ReportCharts.jsx';
import { BusiestHoursHeatmap, ProductMovers } from '../components/AnalyticsCharts.jsx';
import { groupDays, totalOf } from '../lib/analyticsBuckets';
import { todayStr, toLocalDateStr } from '../lib/dateRange';
import { inMainCurrency } from '../lib/orderTotals';
import { fmt } from '../i18n/translate';

// Trends over weeks and months, unlike Reports (one period in detail). The
// backend answers from pre-totalled days, so a year costs a row per day.

// Each range picks the grouping that suits it; the grouping can still be changed.
const RANGES = {
  '30d': { unit: 'day', from: () => daysAgo(29) },
  '12w': { unit: 'week', from: () => daysAgo(83) },
  '12m': {
    unit: 'month',
    from: () => {
      const d = new Date();
      return toLocalDateStr(new Date(d.getFullYear(), d.getMonth() - 11, 1));
    },
  },
};
const UNITS = ['day', 'week', 'month'];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalDateStr(d);
}

const card = 'bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl';
const muted = 'text-slate-500 dark:text-slate-400';

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-sm w-fit">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 h-9 cursor-pointer ${i > 0 ? 'border-l border-[var(--border)]' : ''} ${
            value === o.value
              ? 'bg-[var(--accent)] text-white font-medium'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const { t, locale } = useLocale();
  const a = t.analytics;
  // Remembered across visits, like the other pages' filters.
  const [storeId, setStoreId] = useStoreFilterState('analytics:store', '');
  const [range, setRange] = usePersistentState('analytics:range', '30d', (saved) => (RANGES[saved] ? saved : undefined));
  const [unitChoice, setUnit] = usePersistentState('analytics:unit', null, (saved) => (UNITS.includes(saved) ? saved : undefined));
  const unit = unitChoice ?? RANGES[range].unit;
  const from = RANGES[range].from();
  const to = todayStr();

  const query = useQuery({
    queryKey: queryKeys.analytics({ storeId, from, to }),
    queryFn: () => apiClient.get('/api/analytics', { from, to, ...(storeId ? { storeId } : {}) }),
    placeholderData: (previous) => previous, // keep the last view while a new range loads
  });
  const data = query.data ?? null;
  const mainCurrency = data?.mainCurrency ?? 'USD';
  const inMain = (usd, khr) => (mainCurrency === 'KHR' ? khr : usd);

  const buckets = useMemo(() => (data ? groupDays(data.days, unit) : []), [data, unit]);
  // The previous period lined up bucket by bucket (1st week with 1st week...).
  const previousBuckets = useMemo(() => {
    if (!data) return null;
    const prev = groupDays(data.previousDays, unit);
    return buckets.map((_, i) => prev[i] ?? null);
  }, [data, unit, buckets]);
  const current = data ? totalOf(data.days) : null;
  const previous = data ? totalOf(data.previousDays) : null;
  const avg = (totals) => ({
    usd: totals.orderCount ? totals.revenue / totals.orderCount : 0,
    khr: totals.orderCount ? totals.revenueKhr / totals.orderCount : 0,
  });

  const shortDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(locale === 'km' ? 'km-KH' : 'en-US', { month: 'short', day: 'numeric' });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{a.title}</h1>
      </div>

      <div className={`flex flex-wrap items-end gap-3 mb-4 p-4 ${card}`}>
        <StoreSelect value={storeId} onChange={setStoreId} />
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{a.range}</label>
          <Segmented
            value={range}
            onChange={(r) => {
              setRange(r);
              setUnit(null); // back to that range's own grouping
            }}
            options={Object.keys(RANGES).map((key) => ({ value: key, label: a.ranges[key] }))}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{a.groupBy}</label>
          <Segmented value={unit} onChange={setUnit} options={UNITS.map((u) => ({ value: u, label: a.units[u] }))} />
        </div>
        {query.isFetching && <span className={`text-xs pb-2.5 ${muted}`}>{data ? t.common.loading : a.firstLoad}</span>}
      </div>

      {query.isError && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{query.error?.body?.error || a.loadFailed}</p>}

      {!data ? (
        query.isPending && <p className={`text-sm ${muted}`}>{a.firstLoad}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
            {[
              { key: 'revenue', label: a.revenue, value: inMainCurrency(mainCurrency, current.revenue, current.revenueKhr), now: inMain(current.revenue, current.revenueKhr), before: inMain(previous.revenue, previous.revenueKhr) },
              { key: 'profit', label: a.grossProfit, value: inMainCurrency(mainCurrency, current.profit, current.profitKhr), now: inMain(current.profit, current.profitKhr), before: inMain(previous.profit, previous.profitKhr) },
              { key: 'orders', label: a.orders, value: { primary: current.orderCount.toLocaleString() }, now: current.orderCount, before: previous.orderCount },
              { key: 'basket', label: a.avgBasket, value: inMainCurrency(mainCurrency, avg(current).usd, Math.round(avg(current).khr)), now: inMain(avg(current).usd, avg(current).khr), before: inMain(avg(previous).usd, avg(previous).khr) },
            ].map((c) => (
              <div key={c.key} className={`p-4 ${card}`}>
                <p className={`text-xs ${muted}`}>{c.label}</p>
                <p className="text-xl font-semibold text-[var(--text-h)] mt-1 tabular-nums">{c.value.primary}</p>
                {c.value.secondary && <p className={`text-xs tabular-nums ${muted}`}>{c.value.secondary}</p>}
                <ChangeBadge current={c.now} previous={c.before} label={a.vsPrevious} />
              </div>
            ))}
          </div>
          <p className={`text-xs mb-4 ${muted}`}>
            {fmt(a.comparedWith, {
              from: shortDate(data.range.from),
              to: shortDate(data.range.to),
              prevFrom: shortDate(data.range.prevFrom),
              prevTo: shortDate(data.range.prevTo),
            })}
          </p>

          <section className={`p-4 mb-4 ${card}`}>
            <h2 className="text-sm font-semibold text-[var(--text-h)] mb-2">{a.trend}</h2>
            <SalesOverTimeChart
              buckets={buckets}
              previous={previousBuckets}
              unit={unit}
              mainCurrency={mainCurrency}
              locale={locale}
              labels={{ title: a.trend, revenue: a.revenue, profit: a.grossProfit, orders: a.orders, previous: a.previousRevenue, empty: a.noSales }}
            />
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            <section className={`p-4 ${card}`}>
              <h2 className="text-sm font-semibold text-[var(--text-h)]">{a.busiestHours}</h2>
              <p className={`text-xs mt-0.5 mb-3 ${muted}`}>{a.busiestHoursHint}</p>
              <BusiestHoursHeatmap
                heatmap={data.heatmap}
                mainCurrency={mainCurrency}
                labels={{
                  title: a.busiestHours,
                  orders: a.orders,
                  revenue: a.revenue,
                  ordersWord: a.ordersWord,
                  weekdays: a.weekdays,
                  less: a.less,
                  more: a.more,
                  empty: a.noSales,
                }}
              />
            </section>
            <section className={`p-4 ${card}`}>
              <h2 className="text-sm font-semibold text-[var(--text-h)]">{a.movers}</h2>
              <p className={`text-xs mt-0.5 mb-3 ${muted}`}>
                {fmt(a.moversHint, {
                  from: shortDate(data.movers.range.from),
                  to: shortDate(data.movers.range.to),
                  prevFrom: shortDate(data.movers.range.prevFrom),
                  prevTo: shortDate(data.movers.range.prevTo),
                })}
              </p>
              <ProductMovers
                products={data.movers.products}
                mainCurrency={mainCurrency}
                labels={{ rising: a.rising, falling: a.falling, stopped: a.stopped, none: a.noneYet, soldBefore: a.soldBefore }}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
