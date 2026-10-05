// Receipt reprint for IMS Sales History (issue #6). A hidden iframe rather
// than a popup, so the browser's popup blocker never gets in the way. Marked
// REPRINT (and VOIDED when it is) so it can't pass for the original receipt.

import { orderTotalKhr } from './orderTotals';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const khr = (n) => `${Math.round(Number(n) || 0).toLocaleString()} ៛`;

function receiptHtml(o) {
  const lines = o.items
    .map((i) => {
      const fmt = i.currency === 'KHR' ? khr : usd;
      return `<tr><td>${esc(i.product_name)}<div class="muted">${i.quantity} × ${fmt(i.price)}</div></td><td class="r">${fmt(i.price * i.quantity)}</td></tr>`;
    })
    .join('');
  const paid = [
    o.amount_paid_usd > 0 ? `<tr><td>Paid (USD)</td><td class="r">${usd(o.amount_paid_usd)}</td></tr>` : '',
    o.amount_paid_khr > 0 ? `<tr><td>Paid (KHR)</td><td class="r">${khr(o.amount_paid_khr)}</td></tr>` : '',
    o.change_given_khr > 0 ? `<tr><td>Change</td><td class="r">${khr(o.change_given_khr)}</td></tr>` : '',
  ].join('');
  const payment = `${esc(o.payment_method === 'STATIC_QR' ? 'Static QR' : o.payment_method)}${o.bank_name ? ` (${esc(o.bank_name)})` : ''}`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Receipt ${esc(o.receipt_no)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: 'Kantumruy Pro', 'Noto Sans Khmer', system-ui, sans-serif; font-size: 12px; color: #111; width: 72mm; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; } .muted { color: #666; font-size: 10px; }
  .tag { text-align: center; font-weight: 700; letter-spacing: 2px; border: 1px dashed #111; padding: 2px; margin: 6px 0; }
  .void { color: #b91c1c; border-color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; } td { padding: 2px 0; vertical-align: top; }
  hr { border: 0; border-top: 1px dashed #999; margin: 6px 0; }
  .total td { font-weight: 700; font-size: 14px; }
</style></head><body>
  <h1>${esc(o.store_name)}</h1>
  <div class="c muted">${esc(o.terminal_name)}</div>
  <div class="tag">REPRINT</div>
  ${o.status === 'VOIDED' ? '<div class="tag void">VOIDED</div>' : ''}
  <table>
    <tr><td>Receipt</td><td class="r">#${esc(o.receipt_no)}</td></tr>
    <tr><td>Date</td><td class="r">${esc(new Date(o.created_at).toLocaleString('en-US'))}</td></tr>
    <tr><td>Payment</td><td class="r">${payment}</td></tr>
  </table>
  <hr><table>${lines}</table><hr>
  <table>
    <tr class="total"><td>Total</td><td class="r">${usd(o.total_amount)}</td></tr>
    <tr><td></td><td class="r">${khr(orderTotalKhr(o))}</td></tr>
    ${paid}
  </table>
  <hr><div class="c muted">Printed ${esc(new Date().toLocaleString('en-US'))}</div>
</body></html>`;
}

export function printReceipt(order) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0', right: '0', bottom: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(receiptHtml(order));
  doc.close();
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    // Give the print dialog time to read the document before it goes away.
    setTimeout(() => frame.remove(), 1000);
  };
}
