import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Search, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { useBackend } from './BackendContext';
import { translations as t } from './locales';

const REFRESH_MS = 15_000;
const OPEN_GROUPS = [
  ['CONFIRMED', 'groupToPack', 'groupToPackHint'],
  ['READY', 'groupReady', 'groupReadyHint'],
  ['AWAITING_PAYMENT', 'groupAwaiting', 'groupAwaitingHint'],
];
const MANAGERS = ['INVENTORY', 'ADMIN'];

const usd = (n) => `$${Number(n).toFixed(2)}`;
const khr = (n, rate) => `${Math.round(n * rate).toLocaleString()} ៛`;
const lineTotal = (item) =>
  item.currency === 'KHR' ? `${Math.round(item.price * item.quantity).toLocaleString()} ៛` : usd(item.price * item.quantity);
// The till sits in the shop, so its own clock is the branch's clock.
const time = (iso, withDay = false) =>
  new Date(iso).toLocaleString([], withDay ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' });

function OrderCard({ order, s, rate, canCancel, busy, onReady, onCollect, onCancel }) {
  const open = ['AWAITING_PAYMENT', 'CONFIRMED', 'READY'].includes(order.status);
  const count = order.items.reduce((n, i) => n + i.quantity, 0);
  const payment =
    order.paymentMethod === 'KHQR'
      ? order.status === 'AWAITING_PAYMENT' ? s.unpaidKhqr : s.paidKhqr
      : `${s.payAtCounter}: ${usd(order.totalAmount)} · ${khr(order.totalAmount, rate)}`;

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex flex-col gap-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-2xl font-black tracking-[0.2em] text-slate-900 dark:text-white">{order.pickupCode}</div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {order.customerName} · <span className="font-mono">{order.customerPhone}</span>
          </div>
        </div>
        <div className="text-right text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <div>{s.placed} {time(order.createdAt)}</div>
          <div className="text-slate-800 dark:text-slate-100 text-xs font-bold">
            {s.pickup}: {order.pickupAt ? time(order.pickupAt, true) : s.asap}
          </div>
        </div>
      </div>

      <ul className="text-sm border-y border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
        {order.items.map((item) => (
          <li key={item.productId} className="flex justify-between py-1.5">
            <span className="text-slate-800 dark:text-slate-100">
              <span className="font-black">{item.quantity} ×</span> {item.name}
            </span>
            <span className="text-slate-500 dark:text-slate-400 font-semibold">{lineTotal(item)}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <span>
          {count} {s.items} · <span className="text-slate-900 dark:text-white font-black">{usd(order.totalAmount)}</span> · {payment}
        </span>
        {order.paymentMethod === 'PAY_AT_COUNTER' && order.holdUntil && open && (
          <span className="text-slate-400">{s.heldUntil} {time(order.holdUntil, true)}</span>
        )}
      </div>
      {order.note && (
        <p className="text-sm bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 text-amber-900 dark:text-amber-200">
          {s.note}: {order.note}
        </p>
      )}

      {open && (
        <div className="flex flex-wrap gap-2">
          {order.status === 'CONFIRMED' && (
            <button
              onClick={() => onReady(order)}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-50"
            >
              {s.markReady}
            </button>
          )}
          {(order.status === 'CONFIRMED' || order.status === 'READY') && (
            <button
              onClick={() => onCollect(order)}
              disabled={busy}
              className={`px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 ${
                order.status === 'READY'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {s.collected}
            </button>
          )}
          <button
            onClick={() => onCancel(order)}
            disabled={busy || !canCancel}
            title={canCancel ? undefined : s.cancelManagersOnly}
            className="ml-auto px-3 py-2.5 rounded-xl text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            {s.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

function Dialog({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Website pickup orders for this branch, at the till. Online-only (orders
 * live on the backend): offline, it says so and disables every action.
 */
export default function OnlineOrders({ onBackToRegister, currentLocale, dynamicRate, session, soundOn, onToggleSound }) {
  const client = useBackend();
  const s = t[currentLocale].onlineOrders;
  const canCancel = MANAGERS.includes(session?.role);

  const [view, setView] = useState('OPEN');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(null);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [method, setMethod] = useState('CASH');
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const data = await client.get('/api/online-orders', { status: view });
        setOrders(Array.isArray(data) ? data : []);
        setOffline(null);
        setCheckedAt(new Date());
      } catch (err) {
        setOffline(err?.status === 503 || err?.isNetworkError ? (err.body?.error?.includes('Backend Sync') ? 'notPaired' : 'offline') : null);
        if (err?.status !== 503 && !err?.isNetworkError) setError(s.failed);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [client, view, s.failed]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function act(order, action, extra = {}) {
    setBusyId(order.id);
    setError('');
    try {
      await client.post(`/api/online-orders/${order.id}/${action}`, { actorUserId: session.userId, ...extra });
    } catch (err) {
      if (err?.status === 409) setError(`${order.pickupCode}: ${s.changed}`);
      else if (err?.status === 403) setError(err.body?.error ?? s.cancelManagersOnly);
      else if (err?.status === 503 || err?.isNetworkError) setOffline('offline');
      else setError(s.failed);
    } finally {
      setBusyId(null);
      await load(true);
    }
  }

  function startCollect(order) {
    if (order.paymentMethod === 'KHQR') return act(order, 'collect');
    setMethod('CASH');
    setCollecting(order);
  }

  const needle = search.trim().toUpperCase().replace(/\s/g, '');
  const shown = needle
    ? orders.filter((o) => o.pickupCode.includes(needle) || o.customerPhone.includes(needle) || o.customerName.toUpperCase().includes(needle))
    : orders;
  const card = (o) => (
    <OrderCard
      key={o.id}
      order={o}
      s={s}
      rate={dynamicRate}
      canCancel={canCancel}
      busy={busyId === o.id || Boolean(offline)}
      onReady={(x) => act(x, 'ready')}
      onCollect={startCollect}
      onCancel={setCancelling}
    />
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-900 flex flex-col font-sans text-slate-900 dark:text-white antialiased">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3.5 flex flex-wrap justify-between items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToRegister}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5"
          >
            <ArrowLeft size={14} /> {s.back}
          </button>
          <div>
            <h1 className="text-base font-bold tracking-tight font-display">{s.title}</h1>
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {s.subtitle}
              {checkedAt && !offline && ` · ${s.lastChecked} ${time(checkedAt.toISOString())}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900">
            <Search size={14} className="text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={s.search}
              aria-label={s.search}
              className="bg-transparent outline-none text-sm w-56"
            />
          </label>
          <button
            onClick={onToggleSound}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5"
          >
            {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />} {soundOn ? s.soundOn : s.soundOff}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto flex flex-col gap-5">
          <div className="flex gap-1.5" role="tablist">
            {[
              ['OPEN', s.tabOpen],
              ['COLLECTED', s.tabCollected],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`px-4 py-2 rounded-xl text-xs font-bold ${
                  view === key
                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {offline && (
            <div role="status" className="flex items-center gap-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <WifiOff size={16} /> {s[offline]}
            </div>
          )}
          {error && <p role="alert" className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}

          {loading ? (
            <p className="text-sm text-slate-400">{s.loading}</p>
          ) : shown.length === 0 ? (
            !offline && (
              <p className="text-sm text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
                {needle ? s.noMatch : s.empty}
              </p>
            )
          ) : view === 'OPEN' ? (
            OPEN_GROUPS.map(([status, titleKey, hintKey]) => {
              const group = shown.filter((o) => o.status === status);
              if (group.length === 0) return null;
              return (
                <section key={status} className="flex flex-col gap-2">
                  <div>
                    <h2 className="text-sm font-black text-slate-900 dark:text-white">
                      {s[titleKey]} <span className="text-slate-400 font-semibold">({group.length})</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{s[hintKey]}</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">{group.map(card)}</div>
                </section>
              );
            })
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">{shown.map(card)}</div>
          )}
        </div>
      </main>

      {collecting && (
        <Dialog title={`${s.collectTitle} ${collecting.pickupCode}`} onClose={() => setCollecting(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {s.take}{' '}
            <span className="font-black text-slate-900 dark:text-white">
              {usd(collecting.totalAmount)} · {khr(collecting.totalAmount, dynamicRate)}
            </span>{' '}
            — {collecting.customerName}. {s.collectAsk}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {['CASH', 'KHQR', 'CARD'].map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={`py-3 rounded-xl text-sm font-bold border ${
                  method === m
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                    : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                }`}
              >
                {s[m.toLowerCase()]}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCollecting(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300">
              {s.back2}
            </button>
            <button
              onClick={() => {
                const order = collecting;
                setCollecting(null);
                act(order, 'collect', { paymentMethod: method });
              }}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold"
            >
              {s.confirmCollect}
            </button>
          </div>
        </Dialog>
      )}

      {cancelling && (
        <Dialog title={`${s.cancelTitle} ${cancelling.pickupCode}`} onClose={() => setCancelling(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {s.cancelBody}
            {cancelling.paymentMethod === 'KHQR' && cancelling.status !== 'AWAITING_PAYMENT' && (
              <span className="block mt-2 font-bold text-red-600 dark:text-red-400">
                {s.cancelRefund} ({usd(cancelling.totalAmount)})
              </span>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCancelling(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300">
              {s.keep}
            </button>
            <button
              onClick={() => {
                const order = cancelling;
                setCancelling(null);
                act(order, 'cancel');
              }}
              className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold"
            >
              {s.cancel}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
