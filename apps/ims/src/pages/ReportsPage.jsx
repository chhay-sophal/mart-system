import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useDataTable } from '../hooks/useDataTable';
import { useSearch } from '../hooks/useSearch';
import DataTable from '../components/DataTable.jsx';
import DateRangeFilter from '../components/DateRangeFilter.jsx';
import StoreSelect from '../components/StoreSelect.jsx';
import SearchInput from '../components/SearchInput.jsx';
import FilterButton from '../components/FilterButton.jsx';
import FilterChips from '../components/FilterChips.jsx';
import { CategoryBreakdownChart, PaymentMethodsChart, SalesOverTimeChart, TopProductsChart } from '../components/ReportCharts.jsx';
import { bucketTimeline } from '../lib/reportTimeline';
import { DATE_PRESETS, toApiRange, todayStr } from '../lib/dateRange';
import { inMainCurrency, usdToKhr } from '../lib/orderTotals';
import { fmt, plural } from '../i18n/translate';

// Every shared preset but "All time": the report always covers a bounded
// range (and the server requires both ends).
const REPORT_PRESETS = DATE_PRESETS.filter((key) => key !== 'all');

// Revenue comes summed in both currencies (riel exact for riel sales). Other
// figures are USD; riel stores see them converted at the store's rate.
const money = (store, usd, khr) => inMainCurrency(store.mainCurrency, usd, khr ?? usdToKhr(usd, store.rate));

function Amount({ value }) {
  return (
    <>
      {value.primary} <span className="text-slate-400 dark:text-slate-500 text-xs">{value.secondary}</span>
    </>
  );
}

const card = 'bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl';
const muted = 'text-slate-400 dark:text-slate-500';

// Each store reports its own product list; with several stores in view, the
// same product's rows are summed into one. Profit stays null (unknown) only
// when no store had a cost for it.
function mergeProducts(byStore) {
  const merged = new Map();
  for (const store of byStore) {
    for (const p of store.allProducts) {
      const m = merged.get(p.productId);
      if (!m) {
        merged.set(p.productId, { ...p });
        continue;
      }
      m.totalQty += p.totalQty;
      m.revenue += p.revenue;
      m.revenueKhr += p.revenueKhr;
      m.uncostedQty += p.uncostedQty;
      if (p.profit !== null) {
        m.profit = Math.round(((m.profit ?? 0) + p.profit) * 100) / 100;
        m.profitKhr = Math.round((m.profitKhr ?? 0) + p.profitKhr);
      }
    }
  }
  return [...merged.values()];
}

function mergeMethods(byStore) {
  const merged = new Map();
  for (const store of byStore) {
    for (const m of store.byMethod) {
      const entry = merged.get(m.paymentMethod) ?? { paymentMethod: m.paymentMethod, count: 0, total: 0, totalKhr: 0 };
      entry.count += m.count;
      entry.total += m.total;
      entry.totalKhr += m.totalKhr;
      merged.set(m.paymentMethod, entry);
    }
  }
  return [...merged.values()].sort((a, b) => b.total - a.total);
}

// Sold products summed per category; products with none share the '' key.
function mergeCategories(products, uncategorized) {
  const merged = new Map();
  for (const p of products) {
    const key = p.categoryId ?? '';
    const c = merged.get(key) ?? {
      key,
      name: p.categoryName ?? uncategorized,
      productCount: 0,
      qty: 0,
      revenue: 0,
      revenueKhr: 0,
      profit: null,
      profitKhr: null,
      uncostedQty: 0,
    };
    c.productCount += 1;
    c.qty += p.totalQty;
    c.revenue += p.revenue;
    c.revenueKhr += p.revenueKhr;
    c.uncostedQty += p.uncostedQty;
    if (p.profit !== null) {
      c.profit = Math.round(((c.profit ?? 0) + p.profit) * 100) / 100;
      c.profitKhr = Math.round((c.profitKhr ?? 0) + p.profitKhr);
    }
    merged.set(key, c);
  }
  return [...merged.values()];
}

// Margin is only meaningful when every unit sold had a cost: otherwise the
// profit covers fewer units than the revenue does.
const marginOf = (p) => (p.profit !== null && p.uncostedQty === 0 && p.revenue > 0 ? p.profit / p.revenue : null);

function ShareBar({ ratio }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-20 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs tabular-nums w-12 text-right ${muted}`}>{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function ReportsPage() {
  const { t, locale } = useLocale();
  // Not scoped to the AppShell's single current store: "All stores" is a
  // first-class option here, and the default.
  const [storeId, setStoreId] = useState('');
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);

  // Cached per store + date range (lib/queryClient.js): flipping back to a
  // range already viewed is instant, refreshed in the background when stale.
  const reportQuery = useQuery({
    queryKey: queryKeys.dailySummary({ storeId, dateFrom, dateTo }),
    // A date input cleared by hand leaves the range open-ended, which this
    // report doesn't support: wait (showing the last report) until it's set.
    enabled: Boolean(dateFrom && dateTo),
    queryFn: () => {
      const query = toApiRange(dateFrom, dateTo);
      if (storeId) query.storeId = storeId;
      return apiClient.get('/api/reports/daily-summary', query).then((data) => ({ ...data, dateFrom, dateTo }));
    },
    placeholderData: (previous) => previous, // keep the last report on screen while a new range loads
  });
  const report = reportQuery.data ?? null;
  const loading = reportQuery.isPending;
  const error = reportQuery.isError ? t.reports.loadFailed : '';

  const mainCurrency = report?.combined.mainCurrency ?? 'USD';
  const totalRevenue = report?.combined.totalRevenue ?? 0;
  const products = useMemo(() => (report ? mergeProducts(report.byStore) : []), [report]);
  const methods = useMemo(() => (report ? mergeMethods(report.byStore) : []), [report]);
  const categories = useMemo(() => mergeCategories(products, t.reports.uncategorized), [products, t]);
  const productsRef = useRef(null);
  const totalQty = products.reduce((sum, p) => sum + p.totalQty, 0);
  const timeline = useMemo(
    // Bucketed against the range the report was fetched for, not the inputs,
    // which may already be ahead of it while the next range loads.
    () => (report ? bucketTimeline(report.byStore.flatMap((s) => s.timeline), report.dateFrom, report.dateTo) : null),
    [report]
  );

  const search = useSearch(products, [(p) => p.name, (p) => p.barcode]);
  const table = useDataTable({
    rows: search.results,
    initialSort: { col: 'revenue', dir: 'desc' },
    columns: [
      {
        key: 'name', label: t.reports.product, sortValue: (p) => p.name,
        render: (p) => (
          <>
            <span className="font-medium">{p.name}</span>
            {p.barcode && <span className={`ml-2 text-xs ${muted}`}>#{p.barcode}</span>}
          </>
        ),
      },
      {
        key: 'category', label: t.reports.category, cellClassName: 'text-slate-500 dark:text-slate-400',
        sortValue: (p) => p.categoryName, render: (p) => p.categoryName ?? '—',
        filter: {
          type: 'select',
          options: [...categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.key, label: c.name })),
          value: (p) => p.categoryId ?? '',
        },
      },
      { key: 'qty', label: t.reports.qty, className: 'text-right', cellClassName: 'tabular-nums', sortValue: (p) => p.totalQty, render: (p) => p.totalQty },
      {
        key: 'revenue', label: t.reports.revenue, className: 'text-right', cellClassName: 'tabular-nums whitespace-nowrap',
        sortValue: (p) => p.revenue, render: (p) => <Amount value={inMainCurrency(mainCurrency, p.revenue, p.revenueKhr)} />,
      },
      {
        key: 'share', label: t.reports.share, className: 'text-right',
        sortValue: (p) => p.revenue, render: (p) => <ShareBar ratio={totalRevenue > 0 ? p.revenue / totalRevenue : 0} />,
      },
      {
        key: 'profit', label: t.reports.profit, className: 'text-right', cellClassName: 'tabular-nums whitespace-nowrap',
        // Unknown profit sorts below any real figure, losses included.
        sortValue: (p) => p.profit ?? -Infinity,
        render: (p) =>
          p.profit === null ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">{t.reports.noCost}</span>
          ) : (
            <span
              className={p.profit < 0 ? 'text-red-600 dark:text-red-400' : ''}
              title={p.uncostedQty > 0 ? fmt(t.reports.partlyUncosted, { qty: p.uncostedQty }) : undefined}
            >
              {inMainCurrency(mainCurrency, p.profit, p.profitKhr).primary}
              {p.uncostedQty > 0 && <span className="text-amber-600 dark:text-amber-400">*</span>}
            </span>
          ),
      },
      {
        key: 'margin', label: t.reports.margin, className: 'text-right', cellClassName: 'tabular-nums',
        sortValue: (p) => marginOf(p) ?? -Infinity,
        render: (p) => {
          const margin = marginOf(p);
          if (margin === null) return <span className={muted}>—</span>;
          return <span className={margin < 0 ? 'text-red-600 dark:text-red-400' : ''}>{(margin * 100).toFixed(1)}%</span>;
        },
      },
    ],
  });

  // Clicking a category in the breakdown narrows the products table to it
  // (clicking it again clears that) and brings the table into view.
  const categoryFilter = table.filters.category ?? [];
  const activeCategory = categoryFilter.length === 1 ? categoryFilter[0] : null;
  function selectCategory(key) {
    const next = activeCategory === key ? [] : [key];
    table.setFilter('category', next);
    if (next.length) productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.reports.title}</h1>
      </div>

      <div className={`flex flex-wrap items-end gap-3 mb-4 p-4 ${card}`}>
        <StoreSelect value={storeId} onChange={setStoreId} />
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
          presets={REPORT_PRESETS}
        />
        {reportQuery.isFetching && !loading && <span className={`text-xs pb-2.5 ${muted}`}>{t.common.loading}</span>}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      {loading ? (
        <p className={`text-sm ${muted}`}>{t.common.loading}</p>
      ) : !report ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { key: 'revenue', label: t.reports.revenue, value: inMainCurrency(mainCurrency, report.combined.totalRevenue, report.combined.totalRevenueKhr) },
              { key: 'orders', label: t.reports.orders, value: { primary: report.combined.orderCount } },
              { key: 'avgOrder', label: t.reports.avgOrder, value: inMainCurrency(mainCurrency, report.combined.avgOrder, report.combined.avgOrderKhr) },
              { key: 'grossProfit', label: t.reports.grossProfit, value: inMainCurrency(mainCurrency, report.combined.grossProfit, report.combined.grossProfitKhr) },
            ].map((c) => (
              <div key={c.key} className={`p-4 ${card}`}>
                <p className="text-xs text-slate-500 dark:text-slate-400">{c.label}</p>
                <p className="text-xl font-semibold text-[var(--text-h)] mt-1 tabular-nums">{c.value.primary}</p>
                {c.value.secondary && <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{c.value.secondary}</p>}
              </div>
            ))}
          </div>

          {report.combined.uncostedProductCount > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2 mb-4">
              {fmt(plural(report.combined.uncostedProductCount, t.reports.uncostedOne, t.reports.uncostedMany), {
                count: report.combined.uncostedProductCount,
                amount: inMainCurrency(mainCurrency, report.combined.uncostedRevenue, report.combined.uncostedRevenueKhr).primary,
              })}
            </p>
          )}

          {/* The charts and breakdowns stay above the products table, which
              can run long, so none of them needs scrolling past it. */}
          <div className="grid lg:grid-cols-3 gap-4 mb-4">
            <div className={`p-4 lg:col-span-2 ${card}`}>
              <h2 className="text-sm font-semibold text-[var(--text-h)] mb-2">{t.reports.salesOverTime}</h2>
              <SalesOverTimeChart
                buckets={timeline.buckets}
                unit={timeline.unit}
                mainCurrency={mainCurrency}
                locale={locale}
                labels={{ title: t.reports.salesOverTime, revenue: t.reports.revenue, profit: t.reports.profit, orders: t.reports.orders, empty: t.reports.noSales }}
              />
            </div>
            <div className={`p-4 ${card}`}>
              <h2 className="text-sm font-semibold text-[var(--text-h)] mb-3">{t.reports.paymentBreakdown}</h2>
              <PaymentMethodsChart
                methods={methods}
                mainCurrency={mainCurrency}
                labels={{
                  title: t.reports.paymentBreakdown,
                  total: t.common.total,
                  orders: t.reports.orders.toLowerCase(),
                  empty: t.reports.noOrders,
                  method: (m) => t.sales.methods[m] ?? m,
                }}
              />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <div className={`p-4 ${card}`}>
              <h2 className="text-sm font-semibold text-[var(--text-h)] mb-2">{t.reports.topTen}</h2>
              <TopProductsChart
                products={products}
                mainCurrency={mainCurrency}
                labels={{ revenue: t.reports.revenue, qty: t.reports.qty, units: t.reports.units, empty: t.reports.noSales }}
              />
            </div>
            <div className={`p-4 ${card}`}>
              <h2 className="text-sm font-semibold text-[var(--text-h)] mb-3">{t.reports.categoryBreakdown}</h2>
              <CategoryBreakdownChart
                categories={categories}
                totalRevenue={totalRevenue}
                mainCurrency={mainCurrency}
                activeKey={activeCategory}
                onSelect={selectCategory}
                labels={{
                  empty: t.reports.noSales,
                  revenue: t.reports.revenue,
                  profit: t.reports.profit,
                  noCost: t.reports.noCost,
                  partlyUncosted: (qty) => fmt(t.reports.partlyUncosted, { qty }),
                  filterHint: t.reports.categoryFilterHint,
                  showLess: t.reports.showLess,
                  showAll: (count) => fmt(t.reports.showAll, { count }),
                  meta: (count, qty) =>
                    fmt(t.reports.productCount, { count, products: plural(count, t.reports.productOne, t.reports.productMany), qty }),
                }}
              />
            </div>
          </div>

          {!storeId && report.byStore.length > 1 && (
            <div className={`overflow-hidden mb-4 ${card}`}>
              <h2 className="text-sm font-semibold text-[var(--text-h)] px-4 pt-4 pb-3">{t.reports.byStore}</h2>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
                  <tr>
                    <th className="px-4 py-2">{t.common.store}</th>
                    <th className="px-4 py-2 text-right">{t.reports.orders}</th>
                    <th className="px-4 py-2 text-right">{t.reports.revenue}</th>
                    <th className="px-4 py-2 text-right">{t.reports.grossProfit}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byStore.map((s) => (
                    <tr key={s.storeId} className="border-t border-[var(--border)]">
                      <td className="px-4 py-2">{s.storeName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.orderCount}</td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap"><Amount value={money(s, s.totalRevenue, s.totalRevenueKhr)} /></td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap"><Amount value={money(s, s.grossProfit, s.grossProfitKhr)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section ref={productsRef} className="scroll-mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-h)]">{t.reports.soldProducts}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {fmt(t.reports.productCount, {
                    count: products.length,
                    products: plural(products.length, t.reports.productOne, t.reports.productMany),
                    qty: totalQty,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <FilterButton table={table} />
                <SearchInput value={search.query} onChange={search.setQuery} placeholder={t.reports.searchProducts} shortcut className="flex-1 sm:w-72" />
              </div>
            </div>
            <FilterChips table={table} />
            <DataTable table={table} rowKey={(p) => p.productId} emptyText={t.reports.noSales} noMatchText={t.common.noMatches} />
          </section>
        </>
      )}
    </div>
  );
}
