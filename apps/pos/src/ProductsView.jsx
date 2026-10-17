import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, Plus, X, PackageSearch, RotateCcw } from 'lucide-react';
import { useBackend } from './BackendContext';
import { useToast } from './Toast';
import { translations as t } from './locales';
import { queryKeys } from './queryClient';
import { usdToKhr } from './khr';
import FilterableHeader, { CheckboxFilter, filterInput } from './components/FilterableHeader';
import { useColumnFilter } from './hooks/useColumnFilter';

// Rows drawn at once; the rest are reached by narrowing the search. Keeps
// typing instant on a large catalog.
const MAX_ROWS = 200;

const norm = (value) => String(value ?? '').toLowerCase().trim();

/** Every word of the search must appear in the name (any order), or the search is part of the barcode. */
function matchesProduct(product, search) {
  const q = norm(search);
  if (!q) return true;
  const name = norm(product.name);
  return q.split(/\s+/).every((word) => name.includes(word)) || norm(product.barcode).includes(q);
}

const fmtPrice = (price, currency) =>
  currency === 'KHR' ? `${Math.round(Number(price)).toLocaleString()} ៛` : `$${Number(price).toFixed(2)}`;

// Per-column header filters (issue: "turn these th into filterable
// components"), same shape as IMS's ProductsPage -- applied on top of the
// register's own fast fuzzy search above, not instead of it.
const EMPTY_FILTERS = {
  name: '',
  barcode: '',
  category: [], // ticked category names ('' = no category); none ticked = all
  currency: [], // ticked USD / KHR; none ticked = all
  priceMin: '',
  priceMax: '',
  costPriceMin: '',
  costPriceMax: '',
  stock: [], // ticked low / out / in; none ticked = all; a product passes if it fits any
};

// No per-product threshold here (unlike IMS) -- matches the register's own
// low-stock alert default (see App.jsx's /api/products/low-stock call).
const LOW_STOCK_THRESHOLD = 5;

function matchesStock(p, mode) {
  switch (mode) {
    case 'low': return p.stock <= LOW_STOCK_THRESHOLD;
    case 'out': return p.stock <= 0;
    case 'in': return p.stock > 0;
    default: return false;
  }
}

function matchesColumnFilters(p, f) {
  const name = norm(f.name);
  const barcode = norm(f.barcode);
  if (name && !norm(p.name).includes(name)) return false;
  if (barcode && !norm(p.barcode).includes(barcode)) return false;
  if (f.category.length > 0 && !f.category.includes(p.category || '')) return false;
  if (f.currency.length > 0 && !f.currency.includes(p.currency)) return false;
  const price = Number(p.price);
  if (f.priceMin !== '' && !(price >= Number(f.priceMin))) return false;
  if (f.priceMax !== '' && !(price <= Number(f.priceMax))) return false;
  const costPrice = Number(p.costPrice);
  if (f.costPriceMin !== '' && !(costPrice >= Number(f.costPriceMin))) return false;
  if (f.costPriceMax !== '' && !(costPrice <= Number(f.costPriceMax))) return false;
  return f.stock.length === 0 || f.stock.some((mode) => matchesStock(p, mode));
}

// Price/cost price sort within each currency (USD before KHR): without a
// rate, $1 and 4,100 ៛ can't be ranked against each other.
const COMPARE = {
  name: (a, b) => a.name.localeCompare(b.name),
  barcode: (a, b) => (a.barcode ?? '').localeCompare(b.barcode ?? ''),
  category: (a, b) => (a.category ?? '').localeCompare(b.category ?? ''),
  price: (a, b) => a.currency.localeCompare(b.currency) * -1 || Number(a.price) - Number(b.price),
  costPrice: (a, b) => a.currency.localeCompare(b.currency) * -1 || Number(a.costPrice) - Number(b.costPrice),
  stock: (a, b) => a.stock - b.stock,
};

function sortProducts(products, { col, dir }) {
  const compare = COMPARE[col];
  if (!compare) return products;
  const sign = dir === 'desc' ? -1 : 1;
  // Ties fall back to name, so the order is stable and predictable.
  return [...products].sort((a, b) => sign * compare(a, b) || COMPARE.name(a, b));
}

/**
 * Products tab (issue #13): this branch's catalog, read-only, with a fast
 * search by name or barcode so the cashier can add an item whose barcode
 * won't scan. ↑/↓ pick a row, Enter adds it to the cart.
 */
export default function ProductsView({ currentLocale, cart, onAddToCart, onBackToRegister, mainCurrency, dynamicRate }) {
  const client = useBackend();
  const s = t[currentLocale]?.products || t.en.products;
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' });
  const { openFilterCol, toggleFilterCol, filterPanelRef } = useColumnFilter();
  const listRef = useRef(null);
  const notify = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const productsQuery = useQuery({
    queryKey: queryKeys.products(),
    queryFn: () => client.get('/api/products'),
  });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  // The category filter's choices: every category on this register's
  // products, then "No category" ('').
  const categoryOptions = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)).concat(''),
    [products]
  );

  // Pull the latest catalog from the server now, rather than waiting for the
  // next background sync, then re-read it. Offline (or not paired yet), the
  // register's own copy is re-read anyway.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await client.post('/api/sync/now');
    } catch {
      notify(s.refreshOffline || "Couldn't reach the server. Showing the products saved on this register.");
    }
    await productsQuery.refetch();
    setRefreshing(false);
  };
  const matches = useMemo(() => {
    const filtered = products.filter((p) => matchesProduct(p, search) && matchesColumnFilters(p, filters));
    return sortProducts(filtered, sort);
  }, [products, search, filters, sort]);
  const rows = matches.slice(0, MAX_ROWS);
  const setFilter = (key, value) => { setFilters((prev) => ({ ...prev, [key]: value })); setActive(0); };
  const toggleSort = (col) => {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
    setActive(0);
  };
  // A product can be on several cart lines (one split off for a discount).
  const inCart = useMemo(() => {
    const totals = new Map();
    for (const item of cart) totals.set(item.id, (totals.get(item.id) ?? 0) + item.quantity);
    return totals;
  }, [cart]);
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));

  const changeSearch = (value) => {
    setSearch(value);
    setActive(0);
  };
  const move = (step) => {
    const next = Math.min(Math.max(activeIndex + step, 0), rows.length - 1);
    setActive(next);
    listRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && rows[activeIndex]) { e.preventDefault(); onAddToCart(rows[activeIndex]); }
  };

  const converted = (p) => {
    // The price in the store's other currency, as the register will charge it.
    if (p.currency === mainCurrency) return null;
    return p.currency === 'USD' ? `${usdToKhr(p.price, dynamicRate).toLocaleString()} ៛` : `$${(Number(p.price) / (dynamicRate || 4100)).toFixed(2)}`;
  };

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-900 flex flex-col font-sans text-slate-900 dark:text-white antialiased">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center gap-4 shadow-xs flex-shrink-0">
        <button onClick={onBackToRegister}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors text-slate-500 dark:text-slate-400 cursor-pointer" title={s.back}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold font-display">{s.title}</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">{s.subtitle}</p>
        </div>
        <button onClick={refresh} disabled={refreshing}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors text-slate-500 dark:text-slate-400 cursor-pointer disabled:cursor-not-allowed" title={s.refresh || 'Refresh'} aria-label={s.refresh || 'Refresh'}>
          {/* Spins the way the icon points while the pull runs. */}
          <RotateCcw size={18} className={refreshing ? 'animate-spin [animation-direction:reverse]' : ''} />
        </button>
      </header>

      <div className="px-6 pt-4 pb-3 flex-shrink-0">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" autoFocus value={search} onChange={(e) => changeSearch(e.target.value)} onKeyDown={onKeyDown}
            placeholder={s.searchPlaceholder}
            className="w-full pl-10 pr-10 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400" />
          {search && (
            <button onClick={() => changeSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 cursor-pointer" aria-label={s.clear}>
              <X size={14} />
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
          {productsQuery.isPending ? s.loading : (s.count || '{shown} of {total} products').replace('{shown}', matches.length.toLocaleString()).replace('{total}', products.length.toLocaleString())}
          {matches.length > MAX_ROWS && ` · ${(s.narrow || 'showing the first {max}; keep typing to narrow it down').replace('{max}', MAX_ROWS)}`}
          {' · '}{s.keysHint}
        </p>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-6 pb-6">
        {productsQuery.isError ? (
          <p className="text-sm text-rose-600 dark:text-rose-400 py-8 text-center">{s.loadFailed}</p>
        ) : !productsQuery.isPending && rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400 dark:text-slate-500">
            <PackageSearch size={28} />
            <p className="text-sm">{search ? s.noMatch : s.empty}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
            <table className="w-full text-sm table-fixed">
              {/* Fixed column widths (table-layout: fixed) so sorting -- which
                  only reorders rows, not column content -- can't make a
                  column's width drift as the browser re-measures content. */}
              <colgroup>
                <col style={{ width: '25%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-[11px] text-slate-400 dark:text-slate-500 text-left">
                <tr>
                  <FilterableHeader
                    col="name" label={s.colName} sort={sort} onSort={toggleSort}
                    isOpen={openFilterCol === 'name'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                    hasActiveFilter={filters.name !== EMPTY_FILTERS.name}
                  >
                    <input
                      value={filters.name}
                      onChange={(e) => setFilter('name', e.target.value)}
                      placeholder={s.filterContains}
                      className={filterInput}
                      autoFocus
                    />
                  </FilterableHeader>
                  <FilterableHeader
                    col="barcode" label={s.colBarcode} sort={sort} onSort={toggleSort}
                    isOpen={openFilterCol === 'barcode'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                    hasActiveFilter={filters.barcode !== EMPTY_FILTERS.barcode}
                  >
                    <input
                      value={filters.barcode}
                      onChange={(e) => setFilter('barcode', e.target.value)}
                      placeholder={s.filterContains}
                      className={filterInput}
                    />
                  </FilterableHeader>
                  <FilterableHeader
                    col="category" label={s.colCategory || 'Category'} sort={sort} onSort={toggleSort}
                    isOpen={openFilterCol === 'category'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                    hasActiveFilter={filters.category.length > 0}
                  >
                    <CheckboxFilter
                      options={categoryOptions.map((c) => ({ value: c, label: c || s.noCategory || 'No category' }))}
                      value={filters.category}
                      onChange={(v) => setFilter('category', v)}
                    />
                  </FilterableHeader>
                  <FilterableHeader
                    col="costPrice" label={s.colCostPrice} sort={sort} onSort={toggleSort}
                    isOpen={openFilterCol === 'costPrice'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                    hasActiveFilter={filters.costPriceMin !== EMPTY_FILTERS.costPriceMin || filters.costPriceMax !== EMPTY_FILTERS.costPriceMax}
                  >
                    <div className="flex gap-1">
                      <input type="number" value={filters.costPriceMin} onChange={(e) => setFilter('costPriceMin', e.target.value)} placeholder={s.filterMin} className={`${filterInput} w-20`} />
                      <input type="number" value={filters.costPriceMax} onChange={(e) => setFilter('costPriceMax', e.target.value)} placeholder={s.filterMax} className={`${filterInput} w-20`} />
                    </div>
                  </FilterableHeader>
                  <FilterableHeader
                    col="price" label={s.colPrice} sort={sort} onSort={toggleSort}
                    isOpen={openFilterCol === 'price'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                    hasActiveFilter={filters.currency.length > 0 || filters.priceMin !== EMPTY_FILTERS.priceMin || filters.priceMax !== EMPTY_FILTERS.priceMax}
                  >
                    <div className="flex flex-col gap-1.5">
                      <CheckboxFilter
                        options={[{ value: 'USD', label: 'USD' }, { value: 'KHR', label: 'KHR' }]}
                        value={filters.currency}
                        onChange={(v) => setFilter('currency', v)}
                      />
                      <div className="flex gap-1">
                        <input type="number" value={filters.priceMin} onChange={(e) => setFilter('priceMin', e.target.value)} placeholder={s.filterMin} className={`${filterInput} w-20`} />
                        <input type="number" value={filters.priceMax} onChange={(e) => setFilter('priceMax', e.target.value)} placeholder={s.filterMax} className={`${filterInput} w-20`} />
                      </div>
                    </div>
                  </FilterableHeader>
                  <FilterableHeader
                    col="stock" label={s.colStock} sort={sort} onSort={toggleSort}
                    isOpen={openFilterCol === 'stock'} onToggleFilter={toggleFilterCol} panelRef={filterPanelRef}
                    hasActiveFilter={filters.stock.length > 0}
                  >
                    <CheckboxFilter
                      options={[
                        { value: 'low', label: s.filterStockLow },
                        { value: 'out', label: s.filterStockOut },
                        { value: 'in', label: s.filterStockIn },
                      ]}
                      value={filters.stock}
                      onChange={(v) => setFilter('stock', v)}
                    />
                  </FilterableHeader>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const qty = inCart.get(p.id);
                  return (
                    <tr key={p.id} data-row={i} onMouseEnter={() => setActive(i)}
                      className={`border-t border-slate-100 dark:border-slate-700/60 ${i === activeIndex ? 'bg-indigo-50/70 dark:bg-indigo-950/30' : ''}`}>
                      <td className="px-4 py-2.5 font-semibold truncate" title={p.name}>{p.name}</td>
                      <td className="px-4 py-2.5 font-bold truncate" title={p.barcode || undefined}>{p.barcode || '—'}</td>
                      <td className="px-4 py-2.5 truncate text-slate-500 dark:text-slate-400" title={p.category || undefined}>{p.category || '—'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400" title={fmtPrice(p.costPrice, p.currency)}>
                        {fmtPrice(p.costPrice, p.currency)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" title={[fmtPrice(p.price, p.currency), converted(p)].filter(Boolean).join(' / ')}>
                        <span className="font-bold">{fmtPrice(p.price, p.currency)}</span>
                        {converted(p) && <span className="block text-[11px] text-slate-400">{converted(p)}</span>}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-semibold ${p.stock <= 0 ? 'text-rose-600 dark:text-rose-400' : p.stock <= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}
                        title={`${s.colStock}: ${p.stock}`}
                      >
                        {p.stock}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button onClick={() => onAddToCart(p)}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer">
                          <Plus size={12} /> {s.addToCart}
                          {qty > 0 && <span className="bg-white/25 rounded-full px-1.5 text-[10px]">{qty}</span>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
