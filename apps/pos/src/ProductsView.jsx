import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, Plus, X, PackageSearch } from 'lucide-react';
import { useBackend } from './BackendContext';
import { translations as t } from './locales';
import { queryKeys } from './queryClient';
import { usdToKhr } from './khr';

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
  const listRef = useRef(null);

  const productsQuery = useQuery({
    queryKey: queryKeys.products(),
    queryFn: () => client.get('/api/products'),
  });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const matches = useMemo(() => products.filter((p) => matchesProduct(p, search)), [products, search]);
  const rows = matches.slice(0, MAX_ROWS);
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
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">
                <tr>
                  <th className="px-4 py-2.5">{s.colName}</th>
                  <th className="px-4 py-2.5">{s.colBarcode}</th>
                  <th className="px-4 py-2.5 text-right">{s.colPrice}</th>
                  <th className="px-4 py-2.5 text-right">{s.colStock}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const qty = inCart.get(p.id);
                  return (
                    <tr key={p.id} data-row={i} onMouseEnter={() => setActive(i)}
                      className={`border-t border-slate-100 dark:border-slate-700/60 ${i === activeIndex ? 'bg-indigo-50/70 dark:bg-indigo-950/30' : ''}`}>
                      <td className="px-4 py-2.5 font-semibold">{p.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400">{p.barcode || '—'}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <span className="font-bold">{fmtPrice(p.price, p.currency)}</span>
                        {converted(p) && <span className="block text-[11px] text-slate-400">{converted(p)}</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${p.stock <= 0 ? 'text-rose-600 dark:text-rose-400' : p.stock <= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                        {p.stock}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
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
