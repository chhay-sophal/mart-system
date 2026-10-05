import { translations as t } from '../locales';
import { usdToKhr } from '../khr';

// What a receipt says, independent of how it's printed. The thermal-printer
// renderer (raster.js) lays these blocks out; the on-screen/system-print
// receipt in Invoice.jsx shows the same content with the same formatters.

export const fmtUnit = (price, currency) => {
  const p = Number(price);
  return currency === 'KHR' ? `${Math.round(p).toLocaleString()} ៛` : `$${p.toFixed(2)}`;
};

export const fmtSubtotal = (price, qty, currency) => fmtUnit(Number(price) * qty, currency);

export const discountedUnitPrice = (item) => {
  const p = Number(item.price);
  if (!item.discount) return p;
  return item.discountType === 'fixed' ? Math.max(0, p - item.discount) : p * (1 - item.discount / 100);
};

export const fmtDiscountedSubtotal = (item) => fmtUnit(discountedUnitPrice(item) * item.quantity, item.currency);

export const fmtItemDiscountLabel = (item) =>
  item.discountType === 'fixed' ? `−${fmtUnit(item.discount, item.currency)}` : `−${item.discount}%`;

/** Summary amounts follow the store's main currency; the other one is shown under the total. */
export const currencyFormatters = (mainCurrency, rate) => {
  const usd = (v) => `$${v.toFixed(2)}`;
  const khr = (v) => `${usdToKhr(v, rate).toLocaleString()} ៛`;
  return mainCurrency === 'KHR' ? { primary: khr, secondary: usd } : { primary: usd, secondary: khr };
};

/** The receipt total in the main currency; exact riel when the sale's riel total is known. */
export function fmtTotal({ mainCurrency, dynamicRate, totalUsd, totalKhr }) {
  if (mainCurrency === 'KHR' && totalKhr != null) return `${Number(totalKhr).toLocaleString()} ៛`;
  return currencyFormatters(mainCurrency, dynamicRate).primary(totalUsd);
}

export const receiptNo = (orderId) => `#${String(orderId).padStart(5, '0')}`;

export function receiptDateTime(timestamp, locale) {
  const date = new Date(timestamp);
  const dateStr = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  const timeStr = date.toLocaleTimeString(locale === 'km' ? 'km-KH' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} ${timeStr}`;
}

export function paymentLabel({ paymentMethod, bankName }, inv) {
  if (paymentMethod === 'CASH') return inv.cash;
  if (paymentMethod === 'KHQR') return inv.khqr;
  return bankName ? `${inv.staticQr} — ${bankName}` : inv.staticQr;
}

/**
 * The receipt as a list of blocks:
 *   { type: 'text', text, align, size, bold }   size: 'sm' | 'md' | 'lg'
 *   { type: 'pair', left, right, size, bold }
 *   { type: 'item', no, name, detail, amount, note }
 *   { type: 'rule' } | { type: 'space' }
 */
export function buildReceipt(invoiceData, locale) {
  const inv = t[locale].invoice;
  const {
    order_id, items, subtotalBeforeDiscountUsd, transactionDiscountUsd, totalDiscountUsd, totalUsd,
    mainCurrency, dynamicRate, paymentMethod, amountPaidUsd, amountPaidKhr, changeDueKhr, timestamp,
    storeName, storeAddress, storePhone,
  } = invoiceData;
  const fmt = currencyFormatters(mainCurrency, dynamicRate);
  const blocks = [];
  const add = (block) => blocks.push(block);

  add({ type: 'text', text: storeName || t[locale].shopName, align: 'center', size: 'lg', bold: true });
  if (storeAddress) add({ type: 'text', text: storeAddress, align: 'center', size: 'sm' });
  if (storePhone) add({ type: 'text', text: `${inv.tel} ${storePhone}`, align: 'center', size: 'sm' });
  add({ type: 'rule' });
  add({ type: 'text', text: inv.receiptTitle, align: 'center', size: 'md', bold: true });
  add({ type: 'pair', left: inv.orderId, right: receiptNo(order_id), bold: true });
  add({ type: 'pair', left: inv.date, right: receiptDateTime(timestamp, locale) });
  add({ type: 'rule' });

  add({ type: 'pair', left: inv.item, right: inv.amount, size: 'sm', bold: true });
  items.forEach((item, index) => {
    const discounted = item.discount > 0;
    add({
      type: 'item',
      no: `${index + 1}.`,
      name: item.name,
      detail: `${item.quantity} × ${fmtUnit(discounted ? discountedUnitPrice(item) : item.price, item.currency)}`,
      amount: discounted ? fmtDiscountedSubtotal(item) : fmtSubtotal(item.price, item.quantity, item.currency),
      note: discounted ? `${fmtItemDiscountLabel(item)} (${fmtSubtotal(item.price, item.quantity, item.currency)})` : '',
    });
  });
  add({ type: 'rule' });

  add({ type: 'pair', left: inv.subtotal, right: fmt.primary(subtotalBeforeDiscountUsd) });
  if (transactionDiscountUsd > 0) add({ type: 'pair', left: inv.txDiscount, right: `−${fmt.primary(transactionDiscountUsd)}` });
  if (totalDiscountUsd > 0) add({ type: 'pair', left: inv.discount, right: `−${fmt.primary(totalDiscountUsd)}` });
  add({ type: 'pair', left: inv.total, right: fmtTotal(invoiceData), size: 'lg', bold: true });
  add({ type: 'pair', left: '', right: fmt.secondary(totalUsd) });
  add({ type: 'rule' });

  add({ type: 'pair', left: inv.payment, right: paymentLabel(invoiceData, inv), bold: true });
  if (paymentMethod === 'CASH') {
    if (amountPaidUsd > 0) add({ type: 'pair', left: inv.paidUsd, right: `$${Number(amountPaidUsd).toFixed(2)}` });
    if (amountPaidKhr > 0) add({ type: 'pair', left: inv.paidKhr, right: `${Number(amountPaidKhr).toLocaleString()} ៛` });
    if (changeDueKhr > 0) add({ type: 'pair', left: inv.change, right: `${changeDueKhr.toLocaleString()} ៛`, bold: true });
  }
  add({ type: 'rule' });
  add({ type: 'text', text: inv.thankYou, align: 'center', size: 'sm' });
  return blocks;
}
