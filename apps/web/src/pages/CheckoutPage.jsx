import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { formatPrice } from '../lib/format.js';
import { rememberOrder } from '../lib/myOrders.js';
import { formatPickupTime, formatPickupWhen, groupSlotsByDay } from '../lib/pickup.js';
import { readJson, writeJson } from '../lib/storage.js';
import { useCatalog } from '../lib/useCatalog.js';
import { useResource } from '../lib/useResource.js';
import { useBranch } from '../state/BranchContext.jsx';
import { useCart } from '../state/CartContext.jsx';

// Name and phone are remembered on this device only, as a convenience for the next order.
const CONTACT_KEY = 'storefront.contact';

function errorMessage(err) {
  if (!err) return null;
  if (err.isNetworkError) return 'We couldn’t reach the store. Check your connection and try again.';
  const body = err.body ?? {};
  const fieldErrors = body.details?.fieldErrors;
  if (fieldErrors) {
    const first = Object.values(fieldErrors).flat()[0];
    if (first) return first;
  }
  return body.error ?? 'Something went wrong placing your order. Please try again.';
}

function Section({ title, children }) {
  return (
    <fieldset className="m-0 flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-5 md:p-7">
      <legend className="float-left mb-1 w-full p-0 font-display text-[22px] font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

function Choice({ checked, onChange, name, value, title, children, disabled = false }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-[14px] border-2 p-4 ${
        checked ? 'border-brand bg-[#f1f6f1]' : 'border-line bg-surface'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 size-5 shrink-0 accent-brand"
      />
      <span className="flex flex-col gap-0.5">
        <strong className="text-[15px]">{title}</strong>
        {children && <span className="text-sm text-muted">{children}</span>}
      </span>
    </label>
  );
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { branch, loading: branchesLoading } = useBranch();
  const { lines, names, setQuantity } = useCart();
  const catalog = useCatalog();
  const slots = useResource(branch ? `slots:${branch.id}` : null, () => api.getPickupSlots(branch.id));

  const saved = readJson(CONTACT_KEY, {});
  const [name, setName] = useState(saved.name ?? '');
  const [phone, setPhone] = useState(saved.phone ?? '');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('asap');
  const [slot, setSlot] = useState('');
  const [payment, setPayment] = useState(null);
  // One id per checkout attempt: a double click or a retry after a dropped
  // connection returns the same order instead of placing a second one.
  const [clientOrderUuid] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [shortages, setShortages] = useState([]);

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

  const byId = new Map((catalog.data ?? []).map((p) => [p.id, p]));
  const rows = ids.map((id) => ({ id, qty: lines[id], product: byId.get(id) }));
  const available = rows.filter((r) => r.product && r.product.stockLevel !== 'OUT_OF_STOCK');
  const skipped = rows.filter((r) => !available.includes(r));
  const totals = {};
  for (const r of available) totals[r.product.currency] = (totals[r.product.currency] ?? 0) + r.product.price * r.qty;

  const paymentMethod = payment ?? (branch.khqrAvailable ? 'KHQR' : 'PAY_AT_COUNTER');
  const asap = slots.data?.asap;
  const slotGroups = slots.data ? groupSlotsByDay(slots.data.slots, branch.timezone) : [];
  const canSubmit = available.length > 0 && name.trim() && phone.trim() && (when === 'asap' || slot) && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setShortages([]);
    writeJson(CONTACT_KEY, { name: name.trim(), phone: phone.trim() });
    try {
      const order = await api.placeOrder(branch.id, {
        clientOrderUuid,
        items: available.map((r) => ({ productId: r.id, quantity: r.qty })),
        customerName: name,
        customerPhone: phone,
        note: note.trim() || null,
        pickupAt: when === 'slot' ? slot : null,
        paymentMethod,
      });
      // The cart empties once the order is confirmed (straight away for pay at
      // the counter, after payment for KHQR), so an expired QR keeps it for a retry.
      rememberOrder(order.token, { clearCartOnConfirm: true });
      navigate(`/orders/${encodeURIComponent(order.token)}`, { replace: true });
    } catch (err) {
      if (err.status === 409 && Array.isArray(err.body?.shortages)) setShortages(err.body.shortages);
      else setError(err);
      if (err.status === 400 && when === 'slot') slots.reload();
      setSubmitting(false);
    }
  }

  const fixCart = () => {
    for (const s of shortages) setQuantity(s.productId, s.available);
    setShortages([]);
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-[1200px] px-4 pt-8 pb-16 md:px-8 md:pt-10" noValidate>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/cart" className="text-muted">
          Cart
        </Link>{' '}
        / Checkout
      </nav>
      <h1 className="mt-2 mb-6 font-display text-[36px] font-extrabold tracking-[-0.02em] md:text-[52px]">Checkout</h1>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <div className="flex flex-1 flex-col gap-5">
          <Section title="Your details">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                maxLength={80}
                className="h-12 rounded-xl border border-line-strong bg-surface px-4 text-base"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Phone</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="012 345 678"
                required
                className="h-12 rounded-xl border border-line-strong bg-surface px-4 text-base"
              />
              <span className="text-sm text-muted">So the shop can reach you about your order.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">
                Note for the shop <span className="font-normal text-muted">(optional)</span>
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={2}
                className="rounded-xl border border-line-strong bg-surface px-4 py-3 text-base"
              />
            </label>
          </Section>

          <Section title="Pickup time">
            <Choice name="when" value="asap" checked={when === 'asap'} onChange={() => setWhen('asap')} title="As soon as it’s ready">
              {asap && !asap.availableNow
                ? asap.opensAt
                  ? `${branch.name} is closed right now — ready from ${formatPickupWhen(asap.opensAt, branch.timezone)}.`
                  : `${branch.name} is closed right now.`
                : `Usually packed within a few minutes at ${branch.name}.`}
            </Choice>
            {slotGroups.length > 0 && (
              <Choice name="when" value="slot" checked={when === 'slot'} onChange={() => setWhen('slot')} title="Choose a time">
                Pick a 30-minute window today or tomorrow.
              </Choice>
            )}
            {when === 'slot' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">Pickup window</span>
                <select
                  value={slot}
                  onChange={(e) => setSlot(e.target.value)}
                  required
                  className="h-12 rounded-xl border border-line-strong bg-surface px-3 text-base"
                >
                  <option value="">Select a time…</option>
                  {slotGroups.map(([day, daySlots]) => (
                    <optgroup key={day} label={day}>
                      {daySlots.map((s) => (
                        <option key={s} value={s}>
                          {day}, {formatPickupTime(s, branch.timezone)} –{' '}
                          {formatPickupTime(new Date(new Date(s).getTime() + 30 * 60_000).toISOString(), branch.timezone)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
          </Section>

          <Section title="Payment">
            <Choice
              name="payment"
              value="KHQR"
              checked={paymentMethod === 'KHQR'}
              onChange={() => setPayment('KHQR')}
              disabled={!branch.khqrAvailable}
              title="Pay now with KHQR"
            >
              {branch.khqrAvailable
                ? 'Scan with any KHQR banking app. You’ll get the code on the next screen.'
                : `Not available at ${branch.name} yet.`}
            </Choice>
            <Choice
              name="payment"
              value="PAY_AT_COUNTER"
              checked={paymentMethod === 'PAY_AT_COUNTER'}
              onChange={() => setPayment('PAY_AT_COUNTER')}
              title="Pay at the counter"
            >
              Cash or KHQR when you collect. Unpaid orders are held for a while after your pickup time, then released.
            </Choice>
          </Section>
        </div>

        <aside className="flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-6 lg:sticky lg:top-4 lg:w-[380px] lg:shrink-0">
          <h2 className="m-0 font-display text-[22px] font-bold">Your order</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {available.map(({ id, qty, product }) => (
              <li key={id} className="flex justify-between gap-3 border-b border-[#eeeae0] py-2.5 text-[15px] last:border-b-0">
                <span>
                  {product.name} <span className="text-muted">× {qty}</span>
                </span>
                <strong>{formatPrice(product.price * qty, product.currency)}</strong>
              </li>
            ))}
          </ul>
          {skipped.length > 0 && (
            <p className="m-0 rounded-xl bg-ground p-3 text-sm text-muted">
              Not included (not available at {branch.name}):{' '}
              {skipped.map((r) => r.product?.name ?? names[r.id] ?? 'an item').join(', ')}.
            </p>
          )}
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <strong className="text-[17px]">Total</strong>
            <span className="flex flex-col items-end font-display text-[30px] leading-tight font-extrabold">
              {Object.entries(totals).map(([currency, amount]) => (
                <span key={currency}>{formatPrice(amount, currency)}</span>
              ))}
            </span>
          </div>
          {Object.keys(totals).length > 1 && (
            <p className="m-0 text-sm text-muted">Riel items are converted to dollars at the shop’s rate on the next screen.</p>
          )}
          <p className="m-0 rounded-xl bg-ground p-3.5 text-sm text-muted">
            Pickup at <strong className="text-ink">{branch.name}</strong>.{' '}
            <Link to="/branches" className="font-semibold">
              Change
            </Link>
          </p>

          {shortages.length > 0 && (
            <div role="alert" className="flex flex-col gap-2 rounded-xl border-2 border-low bg-[#fcefe4] p-4 text-sm">
              <strong className="text-[15px]">Some items just ran low</strong>
              <ul className="m-0 pl-5">
                {shortages.map((s) => (
                  <li key={s.productId}>
                    {byId.get(s.productId)?.name ?? names[s.productId] ?? s.name}:{' '}
                    {s.available === 0 ? 'none left' : `only ${s.available} left`}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={fixCart} className="self-start font-semibold text-brand">
                Update my cart to match
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="m-0 rounded-xl border-2 border-low bg-[#fcefe4] p-4 text-sm font-semibold">
              {errorMessage(error)}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="h-14 rounded-[14px] bg-brand text-[17px] font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted"
          >
            {submitting ? 'Placing your order…' : paymentMethod === 'KHQR' ? 'Place order and pay' : 'Place order'}
          </button>
        </aside>
      </div>
    </form>
  );
}
