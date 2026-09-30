import { useEffect, useState } from 'react';
import { formatPrice } from '../lib/format.js';
import { useNow } from '../lib/useNow.js';

function useQrDataUrl(text) {
  const [result, setResult] = useState({ text: null, url: null });
  useEffect(() => {
    let cancelled = false;
    // Lazy: the QR library only downloads for shoppers who reach this screen.
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(text, { margin: 1, width: 480, errorCorrectionLevel: 'M' }))
      .then((url) => !cancelled && setResult({ text, url }));
    return () => {
      cancelled = true;
    };
  }, [text]);
  return result.text === text ? result.url : null;
}

function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The KHQR code for an order awaiting payment, with a countdown to expiry. */
export default function KhqrPayment({ khqr, merchantName }) {
  const now = useNow(1_000);
  const url = useQrDataUrl(khqr.qrString);
  const left = new Date(khqr.expiresAt).getTime() - now.getTime();
  const expired = left <= 0;

  return (
    <div className="flex flex-col items-center gap-5 md:flex-row md:items-center md:gap-10">
      <div className="w-full max-w-[320px] shrink-0 overflow-hidden rounded-[20px] border border-line bg-surface shadow-[0_16px_40px_rgb(23_39_31/0.12)]">
        <div className="bg-khqr px-5 py-3.5 text-xl font-extrabold tracking-[0.06em] text-white">KHQR</div>
        <div className="flex flex-col gap-1 border-b border-dashed border-line-strong px-5 py-4">
          <span className="text-sm text-muted">{merchantName}</span>
          <span className="font-display text-[32px] font-extrabold">{formatPrice(khqr.amount, khqr.currency)}</span>
        </div>
        <div className="flex justify-center p-5">
          {url ? (
            <img
              src={url}
              alt={`KHQR code to pay ${formatPrice(khqr.amount, khqr.currency)}`}
              className={`size-60 ${expired ? 'opacity-25' : ''}`}
            />
          ) : (
            <div className="size-60 rounded-xl bg-ground" aria-hidden="true" />
          )}
        </div>
      </div>

      <div className="flex max-w-md flex-col gap-4">
        <h2 className="m-0 font-display text-[28px] leading-tight font-bold md:text-[32px]">Scan with your banking app</h2>
        <p className="m-0 leading-relaxed text-muted">
          Any KHQR-supported bank works. On this phone? Save the code, then open it from your banking app’s scan screen.
          Your order is confirmed as soon as the payment arrives.
        </p>
        <div role="status" className="flex items-center gap-2.5 rounded-xl bg-surface p-3.5 font-semibold">
          <span className={`size-2.5 rounded-full ${expired ? 'bg-faint' : 'animate-pulse bg-[#d98a2b]'}`} aria-hidden="true" />
          {expired ? 'Code expired — checking one last time…' : `Waiting for payment · ${countdown(left)} left`}
        </div>
        {url && !expired && (
          <a
            href={url}
            download="khqr-payment.png"
            className="flex min-h-12 items-center justify-center self-start rounded-[14px] border border-line-strong bg-surface px-5 font-semibold text-ink no-underline"
          >
            Save QR code
          </a>
        )}
      </div>
    </div>
  );
}
