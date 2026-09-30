import { Link } from 'react-router-dom';
import { TrashIcon } from '../components/Icons.jsx';
import { EmptyState, ErrorState, Loading } from '../components/Status.jsx';
import { aisleTint, formatPrice } from '../lib/format.js';
import { useCatalog } from '../lib/useCatalog.js';
import { useBranch } from '../state/BranchContext.jsx';
import { useCart } from '../state/CartContext.jsx';

function LineStepper({ name, qty, onChange }) {
  return (
    <div className="flex items-center rounded-xl border border-line-strong bg-surface">
      <button type="button" onClick={() => onChange(qty - 1)} aria-label={`One fewer ${name}`} className="size-11 text-xl">
        −
      </button>
      <span className="min-w-8 text-center font-bold" aria-label={`${qty} in cart`}>
        {qty}
      </span>
      <button type="button" onClick={() => onChange(qty + 1)} aria-label={`One more ${name}`} className="size-11 text-xl">
        +
      </button>
    </div>
  );
}

export default function CartPage() {
  const { branch, loading: branchesLoading } = useBranch();
  const { lines, names, setQuantity, remove, clear } = useCart();
  const catalog = useCatalog();

  const ids = Object.keys(lines);
  if (ids.length === 0) {
    return (
      <EmptyState title="Your cart is empty">
        <Link to="/shop" className="font-semibold">
          Start shopping
        </Link>
      </EmptyState>
    );
  }
  if (branchesLoading || catalog.loading) return <Loading />;
  if (catalog.error) return <ErrorState error={catalog.error} onRetry={catalog.reload} />;
  if (!branch) return <EmptyState title="No branches are open yet" />;

  // Join cart ids against the live catalog: prices are always current, and an
  // item this branch doesn't carry (or has run out of) is flagged, not charged.
  const byId = new Map((catalog.data ?? []).map((p) => [p.id, p]));
  const rows = ids.map((id) => ({ id, qty: lines[id], product: byId.get(id) }));
  const available = rows.filter((r) => r.product && r.product.stockLevel !== 'OUT_OF_STOCK');
  const unavailable = rows.filter((r) => !available.includes(r));

  const totals = {};
  for (const r of available) totals[r.product.currency] = (totals[r.product.currency] ?? 0) + r.product.price * r.qty;
  const itemCount = available.reduce((sum, r) => sum + r.qty, 0);

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-8 pb-16 md:px-8 md:pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 font-display text-[36px] font-extrabold tracking-[-0.02em] md:text-[52px]">Your cart</h1>
        <button type="button" onClick={clear} className="min-h-11 font-semibold text-muted hover:text-ink">
          Empty cart
        </button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <div className="flex flex-1 flex-col gap-6">
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {available.map(({ id, qty, product }) => (
              <li key={id} className="flex flex-wrap items-center gap-4 rounded-[18px] border border-line bg-surface p-3.5">
                <span className="size-16 shrink-0 rounded-xl" style={{ backgroundColor: aisleTint(product.category) }} aria-hidden="true" />
                <div className="flex min-w-40 flex-1 flex-col gap-0.5">
                  <Link to={`/products/${id}`} className="font-semibold text-ink no-underline hover:underline">
                    {product.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {formatPrice(product.price, product.currency)} each
                    {product.stockLevel === 'LOW_STOCK' && <span className="font-semibold text-low"> · low stock</span>}
                  </span>
                </div>
                <LineStepper name={product.name} qty={qty} onChange={(n) => setQuantity(id, n)} />
                <strong className="w-20 text-right font-display text-lg">{formatPrice(product.price * qty, product.currency)}</strong>
                <button
                  type="button"
                  onClick={() => remove(id)}
                  aria-label={`Remove ${product.name}`}
                  className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-ground hover:text-ink"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>

          {unavailable.length > 0 && (
            <section className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-5">
              <h2 className="m-0 text-lg font-bold">Not available at {branch.name}</h2>
              <p className="m-0 text-sm text-muted">
                These won’t be included in your order. Try another branch, or remove them.
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {unavailable.map(({ id, product }) => (
                  <li key={id} className="flex items-center justify-between gap-3">
                    <span className="text-[15px]">
                      <Link to={`/products/${id}`}>{product?.name ?? names[id] ?? 'An item from another branch'}</Link>
                      <span className="text-muted"> · {product ? 'out of stock' : 'not sold here'}</span>
                    </span>
                    <button type="button" onClick={() => remove(id)} className="min-h-11 font-semibold text-brand">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-6 lg:w-[380px] lg:shrink-0">
          <h2 className="m-0 font-display text-[22px] font-bold">Order summary</h2>
          <div className="flex justify-between text-[15px] text-muted">
            <span>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
            <span>Pickup · free</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <strong className="text-[17px]">Total</strong>
            <span className="flex flex-col items-end font-display text-[30px] leading-tight font-extrabold">
              {Object.keys(totals).length === 0
                ? formatPrice(0, 'USD')
                : Object.entries(totals).map(([currency, amount]) => <span key={currency}>{formatPrice(amount, currency)}</span>)}
            </span>
          </div>
          <p className="m-0 rounded-xl bg-ground p-3.5 text-sm text-muted">
            Pickup at <strong className="text-ink">{branch.name}</strong>.{' '}
            <Link to="/branches" className="font-semibold">
              Change
            </Link>
          </p>
          {/* Checkout (KHQR or pay at the counter) arrives with online orders in build step 4. */}
          <button
            type="button"
            disabled
            className="h-14 cursor-not-allowed rounded-[14px] bg-line-strong text-[17px] font-semibold text-muted"
          >
            Checkout opening soon
          </button>
          <p className="m-0 text-center text-sm text-muted">Online ordering is almost ready — your cart will be kept.</p>
        </aside>
      </div>
    </div>
  );
}
