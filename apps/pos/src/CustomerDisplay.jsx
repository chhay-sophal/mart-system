import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { QRCodeCanvas } from 'qrcode.react';
import { translations as t } from './locales';
import { CheckCircle2, ShoppingCart } from 'lucide-react';

export default function CustomerDisplay() {
  const [payload, setPayload] = useState(null);
  const [displayState, setDisplayState] = useState('idle');
  const doneTimerRef = useRef(null);

  useEffect(() => {
    const stored = localStorage.getItem('darkMode');
    if (stored === 'true') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, []);

  useEffect(() => {
    let unlisten;
    (async () => {
      unlisten = await listen('customer-display', ({ payload: p }) => {
        if (p.isDark) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
        setPayload(p);
        if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
        setDisplayState(p.state);
        if (p.state === 'done') {
          doneTimerRef.current = setTimeout(() => setDisplayState('idle'), 5000);
        }
      });
    })();
    return () => {
      unlisten?.();
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, []);

  const locale        = payload?.locale        || 'km';
  const cd            = t[locale]?.customerDisplay || t['km'].customerDisplay;
  const storeName     = payload?.storeName     || (locale === 'km' ? 'សូសូ បេប៊ី ម៉ាត' : 'SOSO Baby Mart');
  const storeIcon     = payload?.storeIcon     || '';
  const cart          = payload?.cart          || [];
  const rawSubtotalUsd = payload?.rawSubtotalUsd || 0;
  const txDiscountAmt = payload?.txDiscountAmt || 0;
  const totalUsd      = payload?.totalUsd      || 0;
  const totalKhr      = payload?.totalKhr      || 0;
  const mainCurrency  = payload?.mainCurrency  || 'USD';
  const dynamicRate   = payload?.dynamicRate   || 4100;
  const changeDueKhr  = payload?.changeDueKhr  || 0;
  const paymentMethod = payload?.paymentMethod || 'CASH';
  const tenderedUsd   = payload?.tenderedUsd   || 0;
  const tenderedKhr   = payload?.tenderedKhr   || 0;
  const qrString      = payload?.qrString      || null;

  const hasDiscount   = txDiscountAmt > 0 || cart.some(i => (i.discount || 0) > 0);

  const primaryTotal   = mainCurrency === 'USD' ? `$${totalUsd.toFixed(2)}` : `${Math.round(totalKhr).toLocaleString()} ៛`;
  const secondaryTotal = mainCurrency === 'USD' ? `${Math.round(totalKhr).toLocaleString()} ៛` : `$${totalUsd.toFixed(2)}`;

  const discountedUnitPrice = (item) => {
    const base = Number(item.price);
    if (!item.discount) return base;
    if (item.discountType === 'fixed') return Math.max(0, base - item.discount);
    return base * (1 - item.discount / 100);
  };

  const formatUnitPrice = (item) => {
    const p = discountedUnitPrice(item);
    return item.currency === 'KHR'
      ? `${Math.round(p).toLocaleString()} ៛`
      : `$${p.toFixed(2)}`;
  };

  const formatItemTotal = (item) => {
    const total = discountedUnitPrice(item) * item.quantity;
    return item.currency === 'KHR'
      ? `${Math.round(total).toLocaleString()} ៛`
      : `$${total.toFixed(2)}`;
  };

  /* ── IDLE ───────────────────────────────────────────────── */
  if (displayState === 'idle' || !payload) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex flex-col items-center justify-center gap-8 select-none overflow-hidden">
        <div className="flex flex-col items-center gap-5">
          {storeIcon
            ? <img src={storeIcon} alt="store" className="w-28 h-28 rounded-3xl object-cover shadow-2xl ring-4 ring-white/10" />
            : <div className="w-28 h-28 rounded-3xl bg-indigo-600 flex items-center justify-center shadow-2xl">
                <ShoppingCart size={56} className="text-white" />
              </div>}
          <div className="text-center">
            <h1 className="text-5xl font-black text-white tracking-tight">{storeName}</h1>
            <p className="text-slate-400 text-2xl mt-3 font-medium">{cd.welcome}</p>
          </div>
        </div>
        <p className="text-slate-600 text-sm absolute bottom-8 tracking-wide">{cd.tagline}</p>
      </div>
    );
  }

  /* ── DONE ───────────────────────────────────────────────── */
  if (displayState === 'done') {
    return (
      <div className="h-screen w-screen bg-emerald-950 flex flex-col items-center justify-center gap-7 select-none">
        <CheckCircle2 size={88} className="text-emerald-400" strokeWidth={1.5} />
        <h1 className="text-white font-black text-6xl tracking-tight">{cd.thankYou}</h1>
        {changeDueKhr > 0 && (
          <div className="bg-emerald-900/50 border border-emerald-700/60 rounded-3xl px-10 py-5 text-center mt-2">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-2">{cd.change}</p>
            <p className="text-white font-black text-4xl">{changeDueKhr.toLocaleString()} ៛</p>
          </div>
        )}
      </div>
    );
  }

  /* ── ACTIVE / PAYMENT — 70 / 30 split ──────────────────── */
  const showTendered = paymentMethod === 'CASH' && (tenderedUsd > 0 || tenderedKhr > 0);
  const showKhqr     = paymentMethod === 'KHQR' && qrString;

  return (
    <div className="h-screen w-screen bg-slate-900 flex flex-col overflow-hidden select-none">
      {/* Top bar */}
      <div className="bg-slate-800 border-b border-slate-700/60 px-6 py-2.5 flex items-center gap-3 flex-shrink-0">
        {storeIcon
          ? <img src={storeIcon} alt="store" className="w-7 h-7 rounded-lg object-cover" />
          : <ShoppingCart size={17} className="text-indigo-400" />}
        <span className="text-white font-bold text-sm tracking-wide">{storeName}</span>
        <span className="ml-auto text-slate-500 text-xs font-bold uppercase tracking-widest">
          {cart.reduce((s, i) => s + i.quantity, 0)} {cd.items}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT — 70% — item list */}
        <div className="flex-[7] overflow-y-auto p-5 border-r border-slate-800">
          <table className="min-w-full border-separate border-spacing-y-2">
            <thead>
              <tr className="text-slate-400 text-[11px] font-bold uppercase tracking-widest">
                <th className="w-6 pr-2 text-right">{cd.no}</th>
                <th className="text-left">{cd.item}</th>
                <th className="w-28 text-center">{cd.unitPrice}</th>
                <th className="w-28 text-center">{cd.discount}</th>
                <th className="w-14 text-center">{cd.qty}</th>
                <th className="w-30 text-center">{cd.amount}</th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-20 text-center text-slate-700 text-sm font-bold uppercase tracking-widest">
                    {cd.welcome}
                  </td>
                </tr>
              ) : cart.map((item, idx) => (
                <tr key={item.id} className="bg-slate-800 rounded-2xl border border-slate-700/40 overflow-hidden">
                  <td className="px-6 py-4 text-right text-white font-bold">{idx + 1}</td>
                  <td className="px-0 py-4 text-white font-bold truncate">{item.name}</td>
                  <td className="px-6 py-4 text-right w-24 font-bold text-slate-900 dark:text-white">
                    {item.currency === 'KHR' ? `${Math.round(item.price).toLocaleString()} ៛` : `$${Number(item.price).toFixed(2)}`}
                  </td>
                  <td className="px-4 py-4 text-right w-20 text-amber-400 font-bold">
                    {item.discount > 0
                      ? item.discountType === 'fixed'
                        ? item.currency === 'KHR'
                          ? `-${Math.round(item.discount).toLocaleString()} ៛`
                          : `-$${Number(item.discount).toFixed(2)}`
                        : `-${item.discount}%`
                      : ''}
                  </td>
                  <td className="px-4 py-4 text-center text-slate-500 font-bold w-14">×{item.quantity}</td>
                  <td className="px-6 py-4 text-right">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 line-through">
                      {item.currency === 'KHR'
                        ? `${Math.round(item.price * item.quantity).toLocaleString()} ៛`
                        : `$${(Number(item.price) * item.quantity).toFixed(2)}`
                      }
                    </p>
                    <p className="font-bold text-sm text-slate-900 dark:text-white">
                      {item.currency === 'KHR'
                        ? `${Math.round(discountedUnitPrice(item) * item.quantity).toLocaleString()} ៛`
                        : `$${(discountedUnitPrice(item) * item.quantity).toFixed(2)}`
                      }
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* RIGHT — 30% — total + payment info */}
        <div className="flex-[3] flex flex-col bg-slate-850 border-l border-slate-800 overflow-hidden">

          {/* Per transaction discount */}
          {txDiscountAmt > 0 && (
            <div className="flex-0 flex flex-col items-center justify-center px-6 py-3 border-b border-slate-800">
              <p className="text-amber-400 text-sm font-bold uppercase tracking-widest mb-1">{locale === 'km' ? 'បញ្ចុះតម្លៃ' : 'Discount'}</p>
              <p className="text-white font-black text-4xl leading-none tracking-tight text-center">
                −{mainCurrency === 'USD' ? `$${txDiscountAmt.toFixed(2)}` : `${Math.round(txDiscountAmt * dynamicRate).toLocaleString()} ៛`}
              </p>
            </div>
          )}
          {/* Total */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 border-b border-slate-800">
            <p className="text-slate-500 text-lg font-bold uppercase tracking-widest mb-3">{cd.total}</p>
            {hasDiscount && (
              <p className="text-slate-600 text-2xl font-bold line-through mb-1">
                {mainCurrency === 'USD' ? `$${rawSubtotalUsd.toFixed(2)}` : `${Math.round(rawSubtotalUsd * dynamicRate).toLocaleString()} ៛`}
              </p>
            )}
            <p className="text-white font-black text-6xl leading-none tracking-tight text-center">{primaryTotal}</p>
            <p className="text-slate-500 text-2xl font-bold mt-2">{secondaryTotal}</p>
          </div>

          {/* Payment detail */}
          <div className="flex-2 flex flex-col items-center justify-center px-6 py-6 gap-4">

            {showKhqr && (
              <>
                <div className="bg-white p-3 rounded-2xl shadow-lg">
                  <QRCodeCanvas value={qrString} size={160} level="M" includeMargin={false} />
                </div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest text-center">
                  {locale === 'km' ? 'ស្កេនដើម្បីទូទាត់' : 'Scan to pay via KHQR'}
                </p>
              </>
            )}

            {showTendered && (
              <div className="w-full space-y-3">
                {tenderedKhr > 0 && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-500 text-xl font-bold uppercase tracking-wide">
                      {locale === 'km' ? 'ទទួល (KHR)' : 'Tendered (KHR)'}
                    </span>
                    <span className="text-slate-200 font-black text-3xl">{tenderedKhr.toLocaleString()} ៛</span>
                  </div>
                )}
                {tenderedUsd > 0 && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-500 text-xl font-bold uppercase tracking-wide">
                      {locale === 'km' ? 'ទទួល (USD)' : 'Tendered (USD)'}
                    </span>
                    <span className="text-slate-200 font-black text-3xl">${tenderedUsd.toFixed(2)}</span>
                  </div>
                )}
                {changeDueKhr > 0 && (
                  <div className="flex justify-between items-baseline border-t border-slate-700 pt-3 mt-1">
                    <span className="text-emerald-400 text-xl font-bold uppercase tracking-wide">{cd.change}</span>
                    <span className="text-emerald-400 font-black text-3xl">{changeDueKhr.toLocaleString()} ៛</span>
                  </div>
                )}
              </div>
            )}

            {!showKhqr && !showTendered && (
              <p className="text-slate-700 text-xs font-bold uppercase tracking-widest text-center">
                {paymentMethod === 'STATIC_QR'
                  ? (locale === 'km' ? 'QR ធនាគារ' : 'Bank QR')
                  : cd.awaitingPayment}
              </p>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
