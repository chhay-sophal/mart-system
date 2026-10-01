import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { useAuth } from '../auth/AuthContext.jsx';
import Modal from '../components/Modal.jsx';

// Open orders refresh on their own so the counter sees new ones without reloading.
const REFRESH_MS = 15_000;

const VIEWS = [
  { key: 'OPEN', label: 'Open' },
  { key: 'COLLECTED', label: 'Collected' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'EXPIRED', label: 'Payment expired' },
];

// Open orders, grouped in the order staff work through them.
const OPEN_GROUPS = [
  { status: 'CONFIRMED', title: 'To pack', hint: 'Paid by KHQR, or to be paid at the counter.' },
  { status: 'READY', title: 'Ready for pickup', hint: 'Packed and waiting at the counter.' },
  { status: 'AWAITING_PAYMENT', title: 'Awaiting KHQR payment', hint: "Don't pack yet — the shopper hasn't paid." },
];

const COUNTER_METHODS = [
  ['CASH', 'Cash'],
  ['KHQR', 'KHQR'],
  ['CARD', 'Card'],
];

const usd = (n) => `$${Number(n).toFixed(2)}`;
const money = (n, currency) => (currency === 'KHR' ? `${Math.round(n).toLocaleString('en-US')} ៛` : usd(n));

function formatTime(iso, timezone, withDay = true) {
  const opts = { timeZone: timezone, hour: 'numeric', minute: '2-digit' };
  if (withDay) Object.assign(opts, { weekday: 'short', day: 'numeric', month: 'short' });
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(iso));
}

function pickupLabel(order, timezone) {
  return order.pickupAt ? formatTime(order.pickupAt, timezone) : 'As soon as ready';
}

function paymentLabel(order) {
  if (order.paymentMethod === 'KHQR') return order.status === 'AWAITING_PAYMENT' ? 'KHQR — not paid yet' : 'Paid by KHQR';
  if (order.status === 'COLLECTED') return `Paid at counter (${order.collectedPaymentMethod?.toLowerCase() ?? '—'})`;
  return `Pay at counter: ${usd(order.totalAmount)}`;
}

function OrderCard({ order, timezone, busy, onReady, onCollect, onCancel }) {
  const open = ['AWAITING_PAYMENT', 'CONFIRMED', 'READY'].includes(order.status);
  const count = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xl font-semibold tracking-widest text-[var(--text-h)]">{order.pickupCode}</div>
          <div className="text-sm text-[var(--text-h)]">
            {order.customerName} ·{' '}
            <a href={`tel:${order.customerPhone}`} className="text-[var(--accent)]">
              {order.customerPhone}
            </a>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>Placed {formatTime(order.createdAt, timezone, false)}</div>
          <div className="font-medium text-slate-700">Pickup: {pickupLabel(order, timezone)}</div>
        </div>
      </div>

      <ul className="text-sm divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {order.items.map((item) => (
          <li key={item.productId} className="flex justify-between py-1.5">
            <span>
              <span className="font-medium text-[var(--text-h)]">{item.quantity} ×</span> {item.name}
            </span>
            <span className="text-slate-500">{money(item.price * item.quantity, item.currency)}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-600">
          {count} {count === 1 ? 'item' : 'items'} · <span className="font-semibold text-[var(--text-h)]">{usd(order.totalAmount)}</span> ·{' '}
          {paymentLabel(order)}
        </span>
        {order.paymentMethod === 'PAY_AT_COUNTER' && order.holdUntil && open && (
          <span className="text-xs text-slate-500">Released if not collected by {formatTime(order.holdUntil, timezone)}</span>
        )}
      </div>

      {order.note && <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Note: {order.note}</p>}
      {order.status === 'CANCELLED' && (
        <p className="text-xs text-slate-500">
          {order.cancelReason === 'UNCOLLECTED' ? 'Released automatically — not collected in time.' : 'Cancelled by staff.'}
        </p>
      )}

      {open && (
        <div className="flex flex-wrap gap-2 pt-1">
          {order.status === 'CONFIRMED' && (
            <button
              onClick={() => onReady(order)}
              disabled={busy}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5 disabled:opacity-60"
            >
              Mark ready
            </button>
          )}
          {(order.status === 'CONFIRMED' || order.status === 'READY') && (
            <button
              onClick={() => onCollect(order)}
              disabled={busy}
              className={`text-sm font-medium rounded-lg px-4 py-1.5 disabled:opacity-60 ${
                order.status === 'READY'
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)] text-slate-700 hover:bg-slate-50'
              }`}
            >
              Collected
            </button>
          )}
          <button
            onClick={() => onCancel(order)}
            disabled={busy}
            className="text-sm font-medium text-red-600 hover:text-red-700 px-2 py-1.5 ml-auto disabled:opacity-60"
          >
            Cancel order
          </button>
        </div>
      )}
    </div>
  );
}

export default function OnlineOrdersPage() {
  const { storeId } = useOutletContext();
  const { stores } = useAuth();
  const timezone = stores.find((s) => s.id === storeId)?.timezone ?? 'Asia/Phnom_Penh';

  const [view, setView] = useState('OPEN');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [collectMethod, setCollectMethod] = useState('CASH');
  const [cancelling, setCancelling] = useState(null);

  // `quiet` refreshes (the timer, or after an action) keep the current list on screen.
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setOrders(await apiClient.get(`/api/stores/${storeId}/online-orders`, { status: view }));
        setUpdatedAt(new Date());
        setError('');
      } catch {
        setError('Failed to load online orders.');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [storeId, view]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    if (view !== 'OPEN') return undefined;
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, view]);

  async function act(order, path, body, failure) {
    setBusyId(order.id);
    setError('');
    try {
      await apiClient.post(`/api/stores/${storeId}/online-orders/${order.id}/${path}`, body);
    } catch (err) {
      // 409: someone else (or the automatic release) moved the order first — the refresh below shows where it is now.
      setError(err?.status === 409 ? `Order ${order.pickupCode}: ${err.body?.error ?? 'it just changed.'}` : failure);
    } finally {
      setBusyId(null);
      await load(true);
    }
  }

  function startCollect(order) {
    if (order.paymentMethod === 'KHQR') {
      act(order, 'collect', {}, 'Failed to mark the order collected.');
      return;
    }
    setCollectMethod('CASH');
    setCollecting(order);
  }

  async function confirmCollect() {
    const order = collecting;
    setCollecting(null);
    await act(order, 'collect', { paymentMethod: collectMethod }, 'Failed to mark the order collected.');
  }

  async function confirmCancel() {
    const order = cancelling;
    setCancelling(null);
    await act(order, 'cancel', {}, 'Failed to cancel the order. Only inventory staff and admins can cancel.');
  }

  const needle = search.trim().toUpperCase().replace(/\s/g, '');
  const shown = needle
    ? orders.filter((o) => o.pickupCode.includes(needle) || o.customerPhone.includes(needle) || o.customerName.toUpperCase().includes(needle))
    : orders;

  const cardProps = {
    timezone,
    onReady: (o) => act(o, 'ready', {}, 'Failed to mark the order ready.'),
    onCollect: startCollect,
    onCancel: setCancelling,
  };

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-h)]">Online orders</h1>
          <p className="text-xs text-slate-500">
            Pickup orders from the storefront.{' '}
            {view === 'OPEN' && updatedAt && `Updates automatically · last checked ${formatTime(updatedAt.toISOString(), timezone, false)}.`}
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pickup code, phone or name"
          aria-label="Find an order by pickup code, phone or name"
          className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm w-64"
        />
      </div>

      <div className="flex gap-1 mb-4" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              view === v.key ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500 bg-white border border-[var(--border)] rounded-xl p-5">
          {needle ? 'No order matches that search.' : view === 'OPEN' ? 'No open online orders right now.' : 'Nothing here yet.'}
        </p>
      ) : view === 'OPEN' ? (
        <div className="space-y-6">
          {OPEN_GROUPS.map((group) => {
            const groupOrders = shown.filter((o) => o.status === group.status);
            if (groupOrders.length === 0) return null;
            return (
              <section key={group.status}>
                <h2 className="text-sm font-semibold text-[var(--text-h)]">
                  {group.title} <span className="text-slate-400 font-normal">({groupOrders.length})</span>
                </h2>
                <p className="text-xs text-slate-500 mb-2">{group.hint}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {groupOrders.map((o) => (
                    <OrderCard key={o.id} order={o} busy={busyId === o.id} {...cardProps} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((o) => (
            <OrderCard key={o.id} order={o} busy={false} {...cardProps} />
          ))}
        </div>
      )}

      {collecting && (
        <Modal title={`Collect order ${collecting.pickupCode}`} onClose={() => setCollecting(null)} width="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Take <span className="font-semibold text-[var(--text-h)]">{usd(collecting.totalAmount)}</span> from{' '}
              {collecting.customerName}. How did they pay?
            </p>
            <div className="flex gap-2">
              {COUNTER_METHODS.map(([value, label]) => (
                <label
                  key={value}
                  className={`flex-1 text-center text-sm font-medium border rounded-lg py-2 cursor-pointer ${
                    collectMethod === value
                      ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="collect-method"
                    value={value}
                    checked={collectMethod === value}
                    onChange={() => setCollectMethod(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCollecting(null)} className="text-sm font-medium text-slate-600 px-3 py-1.5">
                Back
              </button>
              <button
                onClick={confirmCollect}
                className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5"
              >
                Paid and collected
              </button>
            </div>
          </div>
        </Modal>
      )}

      {cancelling && (
        <Modal title={`Cancel order ${cancelling.pickupCode}?`} onClose={() => setCancelling(null)} width="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              The items go back into stock and the shopper sees the order as cancelled.
              {cancelling.paymentMethod === 'KHQR' && cancelling.status !== 'AWAITING_PAYMENT' && (
                <span className="block mt-2 font-medium text-red-600">
                  This order was paid by KHQR — refund {usd(cancelling.totalAmount)} to the shopper yourself; the system doesn't
                  refund automatically.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCancelling(null)} className="text-sm font-medium text-slate-600 px-3 py-1.5">
                Keep order
              </button>
              <button onClick={confirmCancel} className="text-sm font-medium bg-red-600 text-white rounded-lg px-4 py-1.5">
                Cancel order
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
