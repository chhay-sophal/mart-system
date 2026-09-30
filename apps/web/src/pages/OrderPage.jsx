import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { OpenBadge } from '../components/BranchHours.jsx';
import KhqrPayment from '../components/KhqrPayment.jsx';
import { PinIcon } from '../components/Icons.jsx';
import { EmptyState, ErrorState, Loading } from '../components/Status.jsx';
import { formatPrice } from '../lib/format.js';
import { takeCartClear } from '../lib/myOrders.js';
import { formatPickupWhen } from '../lib/pickup.js';
import { usePolledOrder } from '../lib/usePolledOrder.js';
import { useBranch } from '../state/BranchContext.jsx';
import { useCart } from '../state/CartContext.jsx';

const CONFIRMED_OR_LATER = new Set(['CONFIRMED', 'READY', 'COLLECTED']);

function headline(order, branchName) {
  switch (order.status) {
    case 'AWAITING_PAYMENT':
      return ['Pay to confirm your order', 'Your items are held for you while the code is valid.'];
    case 'CONFIRMED':
      return ['Order confirmed', `${branchName} is packing it now.`];
    case 'READY':
      return ['Ready for pickup', `Your bag is waiting at the ${branchName} counter.`];
    case 'COLLECTED':
      return ['Collected — thank you!', 'Enjoy, and see you next time.'];
    case 'EXPIRED':
      return ['Payment time ran out', 'Nothing was charged, and the items went back on the shelf. Your cart is still saved.'];
    case 'CANCELLED':
      return order.cancelReason === 'UNCOLLECTED'
        ? ['Order released', 'It wasn’t collected in time, so the items went back on the shelf.']
        : ['Order cancelled', `${branchName} cancelled this order. Call the shop if you have questions.`];
    default:
      return ['Your order', ''];
  }
}

function StatusSteps({ status }) {
  const steps = [
    ['CONFIRMED', 'Confirmed'],
    ['READY', 'Ready'],
    ['COLLECTED', 'Collected'],
  ];
  const reached = { AWAITING_PAYMENT: -1, CONFIRMED: 0, READY: 1, COLLECTED: 2 }[status] ?? -1;
  return (
    <ol className="m-0 flex list-none gap-2 p-0" aria-label="Order progress">
      {steps.map(([key, label], i) => (
        <li key={key} className="flex flex-1 flex-col gap-1.5">
          <span className={`h-1.5 rounded-full ${i <= reached ? 'bg-brand' : 'bg-line'}`} aria-hidden="true" />
          <span className={`text-[13px] font-semibold ${i <= reached ? 'text-brand' : 'text-muted'}`}>
            {label}
            {i === reached && <span className="sr-only"> (current)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function OrderPage() {
  const { token } = useParams();
  const { order, error, loading } = usePolledOrder(token);
  const { stores } = useBranch();
  const { clear } = useCart();

  // Once an order from this browser is confirmed, its cart has done its job.
  const status = order?.status;
  useEffect(() => {
    if (status && CONFIRMED_OR_LATER.has(status) && takeCartClear(token)) clear();
  }, [status, token, clear]);

  if (loading) return <Loading label="Loading your order…" />;
  if (!order) {
    if (error?.status === 404) return <EmptyState title="Order not found">Check the link, or ask the shop.</EmptyState>;
    return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  }

  const store = stores.find((s) => s.id === order.storeId);
  const tz = store?.timezone ?? 'Asia/Phnom_Penh';
  const [title, subtitle] = headline(order, order.storeName);
  const open = CONFIRMED_OR_LATER.has(order.status) && order.status !== 'COLLECTED';
  const directions =
    store &&
    (store.latitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${store.latitude},${store.longitude}`
      : store.address && `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.address)}`);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-8 pb-16 md:px-8 md:pt-10">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-[34px] leading-tight font-extrabold tracking-[-0.02em] md:text-[48px]">{title}</h1>
        <p className="m-0 text-lg text-muted">{subtitle}</p>
        {error && (
          <p role="status" className="m-0 text-sm text-low">
            Having trouble reaching the shop — this page will update when the connection is back.
          </p>
        )}
      </div>

      {order.status === 'AWAITING_PAYMENT' && order.khqr && (
        <section className="rounded-[22px] border border-line bg-surface p-5 md:p-8">
          <KhqrPayment khqr={order.khqr} merchantName={order.storeName} />
        </section>
      )}

      {(open || order.status === 'COLLECTED') && (
        <section className="flex flex-col gap-5 rounded-[22px] border border-line bg-surface p-5 md:flex-row md:items-center md:gap-10 md:p-8">
          <div className="flex flex-col items-center gap-1 rounded-[18px] bg-ground px-8 py-5 text-center">
            <span className="text-sm font-semibold text-muted">Pickup code</span>
            <span className="font-display text-[44px] leading-none font-extrabold tracking-[0.12em]" aria-label={`Pickup code ${order.pickupCode.split('').join(' ')}`}>
              {order.pickupCode}
            </span>
            <span className="text-sm text-muted">Show this at the counter</span>
          </div>
          <div className="flex flex-1 flex-col gap-4">
            <StatusSteps status={order.status} />
            <dl className="m-0 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">Pickup</dt>
              <dd className="m-0 font-semibold">
                {order.pickupAt ? formatPickupWhen(order.pickupAt, tz) : 'As soon as it’s ready'}
              </dd>
              <dt className="text-muted">Payment</dt>
              <dd className="m-0 font-semibold">
                {order.paymentMethod === 'KHQR'
                  ? 'Paid with KHQR'
                  : order.status === 'COLLECTED'
                    ? 'Paid at the counter'
                    : `Pay ${formatPrice(order.totalAmount, 'USD')} at the counter`}
              </dd>
              {order.paymentMethod === 'PAY_AT_COUNTER' && order.holdUntil && open && (
                <>
                  <dt className="text-muted">Held until</dt>
                  <dd className="m-0">{formatPickupWhen(order.holdUntil, tz)}</dd>
                </>
              )}
              <dt className="text-muted">Name</dt>
              <dd className="m-0">
                {order.customerName} · phone ending {order.customerPhoneLast3}
              </dd>
            </dl>
          </div>
        </section>
      )}

      {order.status === 'EXPIRED' && (
        <Link
          to="/checkout"
          className="flex min-h-12 items-center self-start rounded-[14px] bg-brand px-6 font-semibold text-white no-underline hover:bg-brand-dark hover:text-white"
        >
          Try again
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-5 md:p-6">
          <h2 className="m-0 font-display text-[22px] font-bold">Items</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {order.items.map((item) => (
              <li key={item.productId} className="flex justify-between gap-3 border-b border-[#eeeae0] py-2.5 text-[15px] last:border-b-0">
                <span>
                  {item.name} <span className="text-muted">× {item.quantity}</span>
                </span>
                <strong>{formatPrice(item.price * item.quantity, item.currency)}</strong>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <strong>Total</strong>
            <span className="font-display text-2xl font-extrabold">{formatPrice(order.totalAmount, 'USD')}</span>
          </div>
          {order.items.some((i) => i.currency === 'KHR') && (
            <p className="m-0 text-sm text-muted">Riel items converted at ៛{order.exchangeRate.toLocaleString('en-US')} per dollar.</p>
          )}
          {order.note && <p className="m-0 rounded-xl bg-ground p-3 text-sm">Your note: {order.note}</p>}
        </section>

        <section className="flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="m-0 font-display text-[22px] font-bold">{order.storeName}</h2>
            {store && <OpenBadge store={store} />}
          </div>
          {store?.address && <p className="m-0 text-muted">{store.address}</p>}
          {store?.phone && (
            <a href={`tel:${store.phone.replace(/\s/g, '')}`} className="self-start">
              {store.phone}
            </a>
          )}
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-2 self-start rounded-xl border border-line-strong px-4 font-semibold text-ink no-underline"
            >
              <PinIcon className="size-[18px]" />
              Directions
            </a>
          )}
        </section>
      </div>
    </div>
  );
}
