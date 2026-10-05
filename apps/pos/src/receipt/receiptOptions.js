// What the user can change about the printed receipt (Settings > Printer >
// Receipt). Stored per register with the other local settings, as strings.
// The defaults reproduce the receipt as it was before these options existed.

export const RECEIPT_DEFAULTS = {
  receipt_show_logo: 'false',
  receipt_show_address: 'true',
  receipt_show_phone: 'true',
  receipt_header_text: '', // up to MAX_HEADER_LINES lines under the shop details
  receipt_title: '', // '' = the standard title in the receipt's language
  receipt_show_date: 'true',
  receipt_show_cashier: 'false',
  receipt_show_rate: 'false',
  receipt_show_line_numbers: 'true',
  receipt_show_unit_price: 'true',
  receipt_show_discounts: 'true',
  receipt_show_second_currency: 'true',
  receipt_show_payment: 'true',
  receipt_footer_text: '', // '' = the standard thank-you line
  receipt_text_size: 'normal', // small | normal | large
  receipt_darkness: '3', // 1 (lightest) .. 5 (darkest), thermal printers only
  receipt_feed_lines: '3', // blank lines after the receipt (more for printers without a cutter)
  receipt_copies: '1',
  receipt_auto_print: 'false', // print as soon as a sale completes
  receipt_language: '', // '' = the register's display language; 'km' | 'en'
};

export const MAX_HEADER_LINES = 3;
export const MAX_FOOTER_LINES = 5;
export const MAX_COPIES = 3;
export const MAX_FEED_LINES = 10;
export const TEXT_SIZES = ['small', 'normal', 'large'];

const on = (value) => value === 'true';
const clamp = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const lines = (text, max) =>
  String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max);

/** The stored settings as typed options for buildReceipt / renderReceipt. */
export function receiptOptions(settings = {}) {
  const s = { ...RECEIPT_DEFAULTS, ...settings };
  return {
    showLogo: on(s.receipt_show_logo),
    showAddress: on(s.receipt_show_address),
    showPhone: on(s.receipt_show_phone),
    headerLines: lines(s.receipt_header_text, MAX_HEADER_LINES),
    title: String(s.receipt_title || '').trim(),
    showDate: on(s.receipt_show_date),
    showCashier: on(s.receipt_show_cashier),
    showRate: on(s.receipt_show_rate),
    showLineNumbers: on(s.receipt_show_line_numbers),
    showUnitPrice: on(s.receipt_show_unit_price),
    showDiscounts: on(s.receipt_show_discounts),
    showSecondCurrency: on(s.receipt_show_second_currency),
    showPayment: on(s.receipt_show_payment),
    footerLines: lines(s.receipt_footer_text, MAX_FOOTER_LINES),
    textSize: TEXT_SIZES.includes(s.receipt_text_size) ? s.receipt_text_size : 'normal',
    darkness: clamp(s.receipt_darkness, 1, 5, 3),
    feedLines: clamp(s.receipt_feed_lines, 0, MAX_FEED_LINES, 3),
    copies: clamp(s.receipt_copies, 1, MAX_COPIES, 1),
    autoPrint: on(s.receipt_auto_print),
    language: s.receipt_language === 'km' || s.receipt_language === 'en' ? s.receipt_language : '',
  };
}
