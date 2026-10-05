import { translations as t } from '../locales';
import { usdToKhr } from '../khr';
import { receiptOptions } from './receiptOptions';

// What a receipt says, independent of how it's printed. raster.js lays these
// blocks out as an image, which both the thermal printer and the system print
// dialog print, so there's one receipt layout. Only the store name is bold;
// everything else prints at regular weight.

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
 * The receipt as a list of blocks, shaped by the receipt options
 * (receiptOptions.js; the defaults when omitted):
 *   { type: 'image', src }                       the store logo
 *   { type: 'text', text, align, size, bold }     size: 'sm' | 'md' | 'lg'
 *   { type: 'pair', left, right, size, bold }
 *   { type: 'item', no, name, detail, amount, note }  no/detail/note may be empty
 *   { type: 'rule' }
 */
export function buildReceipt(invoiceData, locale, options = receiptOptions()) {
  const inv = t[locale].invoice;
  const o = options;
  const {
    order_id, items, subtotalBeforeDiscountUsd, transactionDiscountUsd, totalDiscountUsd, totalUsd,
    mainCurrency, dynamicRate, paymentMethod, amountPaidUsd, amountPaidKhr, changeDueKhr, timestamp,
    storeName, storeAddress, storePhone, storeIcon, cashierName,
  } = invoiceData;
  const fmt = currencyFormatters(mainCurrency, dynamicRate);
  const blocks = [];
  const add = (block) => blocks.push(block);

  if (o.showLogo && storeIcon) add({ type: 'image', src: storeIcon });
  add({ type: 'text', text: storeName || t[locale].shopName, align: 'center', size: 'lg', bold: true });
  if (o.showAddress && storeAddress) add({ type: 'text', text: storeAddress, align: 'center', size: 'sm' });
  if (o.showPhone && storePhone) add({ type: 'text', text: `${inv.tel} ${storePhone}`, align: 'center', size: 'sm' });
  o.headerLines.forEach((text) => add({ type: 'text', text, align: 'center', size: 'sm' }));
  add({ type: 'rule' });
  add({ type: 'text', text: o.title || inv.receiptTitle, align: 'center', size: 'md' });
  add({ type: 'pair', left: inv.orderId, right: receiptNo(order_id) });
  if (o.showDate) add({ type: 'pair', left: inv.date, right: receiptDateTime(timestamp, locale) });
  if (o.showCashier && cashierName) add({ type: 'pair', left: inv.cashier, right: cashierName });
  if (o.showRate && dynamicRate) add({ type: 'pair', left: inv.exchangeRate, right: `$1 = ${Number(dynamicRate).toLocaleString()} ៛` });
  add({ type: 'rule' });

  add({ type: 'pair', left: inv.item, right: inv.amount, size: 'sm' });
  items.forEach((item, index) => {
    const discounted = item.discount > 0;
    const unit = discounted ? discountedUnitPrice(item) : item.price;
    add({
      type: 'item',
      no: o.showLineNumbers ? `${index + 1}.` : '',
      name: o.showUnitPrice || item.quantity === 1 ? item.name : `${item.quantity} × ${item.name}`,
      detail: o.showUnitPrice ? `${item.quantity} × ${fmtUnit(unit, item.currency)}` : '',
      amount: discounted ? fmtDiscountedSubtotal(item) : fmtSubtotal(item.price, item.quantity, item.currency),
      note: discounted && o.showDiscounts ? `${fmtItemDiscountLabel(item)} (${fmtSubtotal(item.price, item.quantity, item.currency)})` : '',
    });
  });
  add({ type: 'rule' });

  add({ type: 'pair', left: inv.subtotal, right: fmt.primary(subtotalBeforeDiscountUsd) });
  if (o.showDiscounts && transactionDiscountUsd > 0) add({ type: 'pair', left: inv.txDiscount, right: `−${fmt.primary(transactionDiscountUsd)}` });
  if (totalDiscountUsd > 0) add({ type: 'pair', left: inv.discount, right: `−${fmt.primary(totalDiscountUsd)}` });
  add({ type: 'pair', left: inv.total, right: fmtTotal(invoiceData), size: 'lg' });
  if (o.showSecondCurrency) add({ type: 'pair', left: '', right: fmt.secondary(totalUsd) });
  add({ type: 'rule' });

  add({ type: 'pair', left: inv.payment, right: paymentLabel(invoiceData, inv) });
  if (o.showPayment && paymentMethod === 'CASH') {
    if (amountPaidUsd > 0) add({ type: 'pair', left: inv.paidUsd, right: `$${Number(amountPaidUsd).toFixed(2)}` });
    if (amountPaidKhr > 0) add({ type: 'pair', left: inv.paidKhr, right: `${Number(amountPaidKhr).toLocaleString()} ៛` });
    if (changeDueKhr > 0) add({ type: 'pair', left: inv.change, right: `${changeDueKhr.toLocaleString()} ៛` });
  }
  add({ type: 'rule' });
  const footer = o.footerLines.length ? o.footerLines : [inv.thankYou];
  footer.forEach((text) => add({ type: 'text', text, align: 'center', size: 'sm' }));
  return blocks;
}
