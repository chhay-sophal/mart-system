import { invoke } from '@tauri-apps/api/core';
import { buildReceipt } from './receiptModel';
import { drawReceipt, renderReceipt } from './raster';
import { drawerJob, receiptJob } from './escpos';
import { RECEIPT_DEFAULTS, receiptOptions } from './receiptOptions';

const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);

// Per-register settings (Settings > Printer), stored with this register's
// local settings like the display language.
export const PRINTER_DEFAULTS = {
  receipt_printer_mode: 'system', // system (print dialog) | escpos (thermal printer, direct)
  receipt_printer_name: '', // Windows printer name, or tcp:HOST[:PORT]
  receipt_paper_width: '58', // 58 | 80 (mm)
  receipt_auto_cut: 'true',
  cash_drawer_on_cash: 'false', // open the drawer after each cash sale
  ...RECEIPT_DEFAULTS,
};

export const TCP_PREFIX = 'tcp:';

export function printerConfig(settings = {}) {
  const s = { ...PRINTER_DEFAULTS, ...settings };
  const name = (s.receipt_printer_name || '').trim();
  return {
    // Direct printing needs the desktop app and a chosen printer; otherwise
    // receipts go through the system print dialog.
    direct: IS_TAURI && s.receipt_printer_mode === 'escpos' && name !== '',
    name,
    paper: Number(s.receipt_paper_width) === 80 ? 80 : 58,
    cut: s.receipt_auto_cut !== 'false',
    openDrawerOnCash: s.cash_drawer_on_cash === 'true',
    receipt: receiptOptions(s),
  };
}

/** The language the receipt prints in: its own setting, else the register's. */
export const receiptLocale = (config, locale) => config?.receipt?.language || locale;

const blocksFor = (invoiceData, locale, config) =>
  buildReceipt(invoiceData, receiptLocale(config, locale), config.receipt);

const send = (printer, bytes) => invoke('print_raw', { printer, data: Array.from(bytes) });

export const listPrinters = () => (IS_TAURI ? invoke('list_printers') : Promise.resolve([]));

/** The 1-bit image the thermal printer prints (also the Settings preview). */
export const thermalImage = (invoiceData, locale, config) =>
  renderReceipt(blocksFor(invoiceData, locale, config), {
    paper: config.paper,
    textSize: config.receipt.textSize,
    fontWeight: config.receipt.fontWeight,
    darkness: config.receipt.darkness,
  });

/** Renders the receipt and sends it straight to the thermal printer. Rejects with the reason. */
export async function printReceiptDirect(invoiceData, locale, config) {
  const image = await thermalImage(invoiceData, locale, config);
  await send(config.name, receiptJob(image, { cut: config.cut, feedLines: config.receipt.feedLines, copies: config.receipt.copies }));
}

/** The same receipt as a sharp greyscale image (data URL), for the system print dialog. */
export async function receiptImageUrl(invoiceData, locale, config) {
  const canvas = await drawReceipt(blocksFor(invoiceData, locale, config), {
    paper: config.paper,
    textSize: config.receipt.textSize,
    fontWeight: config.receipt.fontWeight,
    mono: false,
    scale: 3,
  });
  return canvas.toDataURL('image/png');
}

export const openCashDrawer = (config) => send(config.name, drawerJob());

/** The shop details a sample receipt shows, from the Settings form's values. */
export const sampleShop = (settings) => ({
  storeName: settings.store_name,
  storeAddress: settings.store_address,
  storePhone: settings.store_phone,
  storeIcon: settings.store_icon,
});

/** A sample receipt for Settings > Printer (preview and test print). */
export function sampleInvoice(shop = {}) {
  return {
    order_id: 123,
    items: [
      { id: 1, name: 'Test item / ទំនិញសាកល្បង', price: 1.5, currency: 'USD', quantity: 2 },
      { id: 2, name: 'Discounted item', price: 4000, currency: 'KHR', quantity: 1, discount: 10, discountType: 'percent' },
    ],
    subtotalBeforeDiscountUsd: 3.98,
    transactionDiscountUsd: 0,
    totalDiscountUsd: 0.1,
    totalUsd: 3.88,
    mainCurrency: shop.mainCurrency || 'USD',
    dynamicRate: shop.rate || 4100,
    paymentMethod: 'CASH',
    amountPaidUsd: 5,
    amountPaidKhr: 0,
    changeDueKhr: 4600,
    timestamp: new Date().toISOString(),
    storeName: shop.storeName,
    storeAddress: shop.storeAddress,
    storePhone: shop.storePhone,
    storeIcon: shop.storeIcon,
    cashierName: shop.cashierName || 'Cashier 1',
  };
}
