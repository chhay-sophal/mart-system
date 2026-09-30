import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Loading } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { formatPrice } from '../lib/format.js';
import { listMyOrders } from '../lib/myOrders.js';

const SHOWN = 10;

const STATUS_LABEL = {
  AWAITING_PAYMENT: ['Awaiting payment', 'bg-[#fcefe4] text-low'],
  CONFIRMED: ['Being packed', 'bg-brand-soft text-brand'],
  READY: ['Ready for pickup', 'bg-sun text-ink'],
  COLLECTED: ['Collected', 'bg-[#eeeae0] text-muted'],
  CANCELLED: ['Cancelled', 'bg-[#eeeae0] text-muted'],
  EXPIRED: ['Payment expired', 'bg-[#eeeae0] text-muted'],
};

/** Orders placed from this browser (see lib/myOrders.js) — no account needed to find a pickup code again. */
export default function MyOrdersPage() {
  const [tokens] = useState(() => listMyOrders().slice(0, SHOWN).map((o) => o.token));
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(tokens.map((t) => api.getOrder(t).catch(() => null))).then((results) => {
      if (!cancelled) setOrders(results.filter(Boolean));
    });
    return () => {
      cancelled = true;
    };
  }, [tokens]);

  if (tokens.length === 0) {
    return (
      <EmptyState title="No orders yet">
        Orders you place on this device show up here.{' '}
        <Link to="/shop" className="font-semibold">
          Start shopping
        </Link>
      </EmptyState>
    );
  }
  if (!orders) return <Loading label="Loading your orders…" />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-8 pb-16 md:px-8 md:pt-10">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[36px] font-extrabold tracking-[-0.02em] md:text-[52px]">Your orders</h1>
        <p className="m-0 text-muted">Orders placed on this device.</p>
      </div>
      {orders.length === 0 ? (
        <EmptyState title="We couldn’t load your orders">Check your connection and try again.</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {orders.map((order) => {
            const [label, cls] = STATUS_LABEL[order.status] ?? [order.status, 'bg-[#eeeae0] text-muted'];
            const count = order.items.reduce((n, i) => n + i.quantity, 0);
            return (
              <li key={order.token}>
                <Link
                  to={`/orders/${encodeURIComponent(order.token)}`}
                  className="flex flex-wrap items-center gap-4 rounded-[18px] border border-line bg-surface p-4 text-ink no-underline hover:border-brand"
                >
                  <span className="font-display text-2xl font-extrabold tracking-[0.1em]">{order.pickupCode}</span>
                  <span className="flex min-w-40 flex-1 flex-col">
                    <strong>{order.storeName}</strong>
                    <span className="text-sm text-muted">
                      {new Date(order.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ·{' '}
                      {count} {count === 1 ? 'item' : 'items'} · {formatPrice(order.totalAmount, 'USD')}
                    </span>
                  </span>
                  <span className={`rounded-full px-3 py-1 text-[13px] font-bold ${cls}`}>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
