import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { aisleOf, aisleTint, formatPrice, STOCK_LABEL, STOCK_TEXT_CLASS } from '../lib/format.js';
import { useCatalog } from '../lib/useCatalog.js';
import { useResource } from '../lib/useResource.js';
import { useBranch } from '../state/BranchContext.jsx';
import { useCart } from '../state/CartContext.jsx';

const STOCK_DOT_CLASS = {
  IN_STOCK: 'bg-ok',
  LOW_STOCK: 'bg-[#d98a2b]',
  OUT_OF_STOCK: 'border-2 border-faint',
};

function Availability({ productId, branchId, chooseBranch }) {
  const availability = useResource(`availability:${productId}`, () => api.getAvailability(productId));
  if (availability.loading || availability.error || !availability.data) return null;

  return (
    <div className="flex flex-col rounded-[18px] border border-line bg-surface px-5 py-2">
      <div className="flex items-center justify-between border-b border-[#eeeae0] py-3">
        <strong className="text-[15px]">Availability by branch</strong>
        <Link to="/branches" className="text-sm font-semibold">
          All branches
        </Link>
      </div>
      <ul className="m-0 list-none p-0">
        {availability.data.map((row) => {
          const mine = row.storeId === branchId;
          return (
            <li key={row.storeId} className="flex items-center gap-3 border-b border-[#eeeae0] py-3 last:border-b-0">
              <span className={`size-2.5 shrink-0 rounded-full ${STOCK_DOT_CLASS[row.stockLevel]}`} aria-hidden="true" />
              <span className="flex-1 text-[15px]">
                {mine ? <strong>{row.storeName}</strong> : row.storeName}
                {mine && ' · your branch'}
              </span>
              <span className={`text-sm font-semibold ${STOCK_TEXT_CLASS[row.stockLevel]}`}>{STOCK_LABEL[row.stockLevel]}</span>
              {!mine && row.stockLevel !== 'OUT_OF_STOCK' && (
                <button type="button" onClick={() => chooseBranch(row.storeId)} className="min-h-11 text-sm font-semibold text-brand">
                  Switch
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuantityStepper({ value, onChange, max }) {
  return (
    <div className="flex items-center rounded-[14px] border border-line-strong bg-surface">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label="Decrease quantity"
        className="h-14 w-13 text-2xl"
      >
        −
      </button>
      <span aria-live="polite" className="min-w-10 text-center text-lg font-bold">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase quantity"
        className="h-14 w-13 text-2xl"
      >
        +
      </button>
    </div>
  );
}

// Keyed by id so quantity and other local state reset when moving between products.
export default function ProductRoute() {
  const { productId } = useParams();
  return <ProductPage key={productId} productId={productId} />;
}

function ProductPage({ productId }) {
  const { branch, chooseBranch, loading: branchesLoading } = useBranch();
  const { add, lines } = useCart();
  const [qty, setQty] = useState(1);
  const product = useResource(branch ? `product:${branch.id}:${productId}` : null, () =>
    api.getProduct(branch.id, productId),
  );
  const catalog = useCatalog();

  const related = useMemo(() => {
    if (!product.data || !catalog.data) return [];
    return catalog.data
      .filter((p) => p.id !== product.data.id && aisleOf(p) === aisleOf(product.data) && p.stockLevel !== 'OUT_OF_STOCK')
      .slice(0, 4);
  }, [product.data, catalog.data]);

  if (branchesLoading || product.loading) return <Loading />;
  if (!branch) return <EmptyState title="No branches are open yet" />;
  if (product.error?.status === 404) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 pb-16">
        <EmptyState title={`Not sold at ${branch.name}`}>This product isn’t carried at your branch right now.</EmptyState>
        <Availability productId={productId} branchId={branch.id} chooseBranch={chooseBranch} />
      </div>
    );
  }
  if (product.error) return <ErrorState error={product.error} onRetry={product.reload} />;

  const p = product.data;
  const soldOut = p.stockLevel === 'OUT_OF_STOCK';
  const inCart = lines[p.id] ?? 0;
  const aisle = aisleOf(p);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 pt-8 pb-16 md:px-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/" className="text-muted">
          Home
        </Link>{' '}
        /{' '}
        <Link to={`/shop?aisle=${encodeURIComponent(aisle)}`} className="text-muted">
          {aisle}
        </Link>{' '}
        / {p.name}
      </nav>

      <div className="grid gap-8 md:grid-cols-2 md:gap-16">
        <div className="h-72 rounded-[28px] md:h-[520px]" style={{ backgroundColor: aisleTint(p.category) }} aria-hidden="true" />
        <div className="flex flex-col gap-5">
          <span className="self-start rounded-full px-3 py-1.5 text-[13px] font-bold" style={{ backgroundColor: aisleTint(p.category) }}>
            {aisle}
          </span>
          <h1 className="m-0 font-display text-[36px] leading-[1.02] font-extrabold tracking-[-0.02em] md:text-[54px]">{p.name}</h1>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-display text-[40px] font-extrabold">{formatPrice(p.price, p.currency)}</span>
            <span className={`font-semibold ${STOCK_TEXT_CLASS[p.stockLevel]}`}>
              {STOCK_LABEL[p.stockLevel]} at {branch.name}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <QuantityStepper value={qty} onChange={setQty} max={99 - inCart} />
            <button
              type="button"
              disabled={soldOut || inCart >= 99}
              onClick={() => {
                add(p.id, qty);
                setQty(1);
              }}
              className="h-14 min-w-56 flex-1 rounded-[14px] bg-brand px-6 text-[17px] font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted"
            >
              {soldOut ? 'Out of stock here' : `Add ${qty} to cart · ${formatPrice(p.price * qty, p.currency)}`}
            </button>
          </div>
          {inCart > 0 && (
            <p className="m-0 text-[15px] text-muted" role="status">
              {inCart} in your cart ·{' '}
              <Link to="/cart" className="font-semibold">
                View cart
              </Link>
            </p>
          )}

          <Availability productId={p.id} branchId={branch.id} chooseBranch={chooseBranch} />
        </div>
      </div>

      {related.length > 0 && (
        <section className="flex flex-col gap-5 pt-4">
          <h2 className="m-0 font-display text-[28px] font-bold md:text-[32px]">More from {aisle}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
            {related.map((r) => (
              <Link
                key={r.id}
                to={`/products/${r.id}`}
                className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-3 text-ink no-underline"
              >
                <span className="size-[72px] shrink-0 rounded-[10px]" style={{ backgroundColor: aisleTint(r.category) }} aria-hidden="true" />
                <span className="flex flex-col gap-1">
                  <span className="text-[15px] leading-snug font-semibold">{r.name}</span>
                  <span className="font-display text-lg font-bold">{formatPrice(r.price, r.currency)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
