import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { EmptyState, ErrorState, Loading } from '../components/Status.jsx';
import { aisleOf } from '../lib/format.js';
import { useCatalog } from '../lib/useCatalog.js';
import { useBranch } from '../state/BranchContext.jsx';

const SORTS = {
  name: { label: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
  'price-asc': { label: 'Price: low to high', fn: (a, b) => a.price - b.price },
  'price-desc': { label: 'Price: high to low', fn: (a, b) => b.price - a.price },
};

export default function CatalogPage() {
  const { branch, loading: branchesLoading, error: branchError, reload: reloadBranches } = useBranch();
  const catalog = useCatalog();
  // Filters live in the URL so a filtered aisle can be linked to, shared, and survives reload.
  const [params, setParams] = useSearchParams();
  const aisle = params.get('aisle');
  const q = params.get('q')?.trim() ?? '';
  const inStockOnly = params.get('stock') === 'in';
  const sort = SORTS[params.get('sort')] ? params.get('sort') : 'name';

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const products = catalog.data;
  const aisles = useMemo(() => {
    const counts = new Map();
    for (const p of products ?? []) counts.set(aisleOf(p), (counts.get(aisleOf(p)) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products]);

  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return (products ?? [])
      .filter((p) => !aisle || aisleOf(p) === aisle)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .filter((p) => !inStockOnly || p.stockLevel !== 'OUT_OF_STOCK')
      .sort(SORTS[sort].fn);
  }, [products, aisle, q, inStockOnly, sort]);

  if (branchError) return <ErrorState error={branchError} onRetry={reloadBranches} />;
  if (catalog.error) return <ErrorState error={catalog.error} onRetry={catalog.reload} />;
  if (!branch && !branchesLoading) return <EmptyState title="No branches are open yet" />;

  const heading = q ? `Results for “${q}”` : aisle ?? 'Shop all';
  const aisleButton = (value, label, count) => {
    const active = (aisle ?? null) === value;
    return (
      <button
        key={label}
        type="button"
        aria-pressed={active}
        onClick={() => setParam('aisle', value)}
        className={`flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-xl px-3.5 text-left text-[15px] font-semibold ${
          active ? 'bg-brand text-white' : 'bg-surface text-ink hover:bg-brand-soft md:bg-transparent'
        }`}
      >
        <span>{label}</span>
        <span className="text-[13px] opacity-75">{count}</span>
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-8 pb-16 md:px-8 md:pt-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/" className="text-muted">
          Home
        </Link>{' '}
        / Shop
      </nav>
      <div className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="m-0 font-display text-[36px] font-extrabold tracking-[-0.02em] md:text-[52px]">{heading}</h1>
          {products && (
            <span className="text-muted">
              {shown.length} {shown.length === 1 ? 'product' : 'products'}
            </span>
          )}
        </div>
        <label className="flex items-center gap-2.5 text-[15px] text-muted">
          Sort by
          <select
            value={sort}
            onChange={(e) => setParam('sort', e.target.value === 'name' ? null : e.target.value)}
            className="h-11 rounded-[10px] border border-line-strong bg-surface px-3 text-ink"
          >
            {Object.entries(SORTS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <aside className="flex flex-col gap-5 md:w-[250px] md:shrink-0 md:gap-7">
          <div role="group" aria-label="Aisles" className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-col md:gap-1.5 md:overflow-visible md:px-0">
            <span className="hidden pb-1.5 text-[13px] font-bold tracking-[0.08em] text-muted uppercase md:block">Aisles</span>
            {aisleButton(null, 'All products', products?.length ?? 0)}
            {aisles.map(([name, count]) => aisleButton(name, name, count))}
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] md:border-t md:border-line md:pt-5">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setParam('stock', e.target.checked ? 'in' : null)}
              className="size-5 accent-brand"
            />
            Hide out-of-stock items
          </label>
          {q && (
            <button type="button" onClick={() => setParam('q', null)} className="self-start font-semibold text-brand">
              Clear search
            </button>
          )}
        </aside>

        <div className="flex-1">
          {catalog.loading || branchesLoading ? (
            <Loading label="Loading the shelves…" />
          ) : shown.length === 0 ? (
            <EmptyState title="Nothing here right now">
              {q ? 'Try a different search, or browse all products.' : 'Try another aisle or show out-of-stock items.'}
            </EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-5 lg:grid-cols-4">
              {shown.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
