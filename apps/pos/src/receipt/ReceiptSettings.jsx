import { useEffect, useState } from 'react';
import { translations as t } from '../locales';
import { PAPER_DOTS, bitsToCanvas } from './raster';
import { printerConfig, receiptImageUrl, receiptLocale, sampleInvoice, sampleShop, thermalImage } from './thermalPrinter';
import { FONT_WEIGHTS, MAX_COPIES, MAX_FEED_LINES, TEXT_SIZES } from './receiptOptions';

const PREVIEW_DELAY_MS = 250;

/**
 * Settings > Printer > Receipt (per register): what the printed receipt
 * shows, with a live preview of a sample sale. Edits the receipt_* settings
 * in the parent form, so nothing changes until Save.
 */
export default function ReceiptSettings({ settings, setSettings, p, locale, ToggleRow, inputClass }) {
  const r = p.receipt || {};
  const [preview, setPreview] = useState(null);
  const set = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const flag = (key) => ({ checked: settings[key] === 'true', onChange: (v) => set(key, v ? 'true' : 'false') });
  const thermal = settings.receipt_printer_mode === 'escpos';
  const config = printerConfig(settings);
  const inv = t[receiptLocale(config, locale)].invoice;
  const previewWidth = PAPER_DOTS[config.paper];

  // Re-render the preview a moment after the last change, as the selected
  // printer will print it (dots for the thermal printer, greyscale otherwise).
  const previewKey = JSON.stringify([settings, locale]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const sample = sampleInvoice(sampleShop(settings));
        const url = thermal
          ? bitsToCanvas(await thermalImage(sample, locale, config)).toDataURL('image/png')
          : await receiptImageUrl(sample, locale, config);
        if (!cancelled) setPreview(url);
      } catch (err) {
        console.error('Receipt preview failed', err);
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const option = (selected) =>
    `py-2 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700'}`;
  const choices = (key, values, labelFor) => (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
      {values.map((value) => (
        <button key={value || 'default'} type="button" className={option((settings[key] ?? '') === value)} onClick={() => set(key, value)}>
          {labelFor(value)}
        </button>
      ))}
    </div>
  );
  const group = (title) => (
    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 pt-2">{title}</p>
  );
  const label = (text, help) => (
    <>
      <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{text}</span>
      {help && <span className="block text-xs text-slate-400 dark:text-slate-500 mt-0.5">{help}</span>}
    </>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{r.preview || 'Preview'}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-2">{r.previewNote}</p>
        <div className="rounded-xl bg-slate-100 dark:bg-slate-900 p-4 max-h-[600px] overflow-y-auto flex justify-center">
          {preview
            // One screen pixel per printer dot (narrower only when the card is), smoothly
            // scaled: shrinking a 1-bit receipt pixel by pixel drops parts of letters.
            ? <img src={preview} alt="" className="w-full h-auto shadow-md bg-white" style={{ maxWidth: previewWidth }} />
            : <div className="w-full h-64 bg-white/60 dark:bg-slate-800 animate-pulse" style={{ maxWidth: previewWidth }} />}
        </div>
      </div>

      {group(r.groupHeader || 'Header')}
      <ToggleRow label={r.showLogo || 'Store logo'} help={settings.store_icon ? r.logoHelp : r.noLogo} {...flag('receipt_show_logo')} />
      <ToggleRow label={r.showAddress || 'Address'} {...flag('receipt_show_address')} />
      <ToggleRow label={r.showPhone || 'Phone number'} {...flag('receipt_show_phone')} />
      <label className="block">
        {label(r.headerText || 'Extra lines under the shop details', r.headerTextHelp)}
        <textarea rows={3} value={settings.receipt_header_text || ''} onChange={(e) => set('receipt_header_text', e.target.value)}
          className={`${inputClass} mt-1.5 resize-none`} />
      </label>
      <label className="block">
        {label(r.title || 'Receipt title')}
        <input type="text" value={settings.receipt_title || ''} onChange={(e) => set('receipt_title', e.target.value)}
          className={`${inputClass} mt-1.5`} placeholder={inv.receiptTitle} />
      </label>

      {group(r.groupSale || 'Sale details')}
      <ToggleRow label={r.showDate || 'Date & time'} {...flag('receipt_show_date')} />
      <ToggleRow label={r.showCashier || 'Cashier name'} {...flag('receipt_show_cashier')} />
      <ToggleRow label={r.showRate || 'Exchange rate'} {...flag('receipt_show_rate')} />

      {group(r.groupItems || 'Items')}
      <ToggleRow label={r.showLineNumbers || 'Line numbers'} {...flag('receipt_show_line_numbers')} />
      <ToggleRow label={r.showUnitPrice || 'Quantity × unit price'} {...flag('receipt_show_unit_price')} />
      <ToggleRow label={r.showDiscounts || 'Discount details'} {...flag('receipt_show_discounts')} />

      {group(r.groupTotals || 'Totals & payment')}
      <ToggleRow label={r.showSecondCurrency || 'Total in the second currency'} {...flag('receipt_show_second_currency')} />
      <ToggleRow label={r.showPayment || 'Amount paid & change'} {...flag('receipt_show_payment')} />

      {group(r.groupFooter || 'Footer')}
      <label className="block">
        {label(r.footerText || 'Footer', r.footerTextHelp)}
        <textarea rows={3} value={settings.receipt_footer_text || ''} onChange={(e) => set('receipt_footer_text', e.target.value)}
          className={`${inputClass} mt-1.5 resize-none`} placeholder={inv.thankYou} />
      </label>

      {group(r.groupLayout || 'Layout & printing')}
      <div>
        {label(r.language || 'Receipt language')}
        <div className="mt-2">
          {choices('receipt_language', ['', 'km', 'en'], (v) => (v === '' ? r.languageFollow || 'Same as the screen' : v === 'km' ? 'ខ្មែរ' : 'English'))}
        </div>
      </div>
      <div>
        {label(r.textSize || 'Text size')}
        <div className="mt-2">
          {choices('receipt_text_size', TEXT_SIZES, (v) => ({ small: r.sizeSmall || 'Small', normal: r.sizeNormal || 'Normal', large: r.sizeLarge || 'Large' })[v])}
        </div>
      </div>
      <div>
        {label(r.fontWeight || 'Font weight')}
        <div className="mt-2">
          {choices('receipt_font_weight', FONT_WEIGHTS, (v) => ({ light: r.weightLight || 'Light', normal: r.weightNormal || 'Normal', bold: r.weightBold || 'Bold' })[v])}
        </div>
      </div>
      {thermal && (
        <label className="block">
          {label(`${r.darkness || 'Print darkness'}: ${config.receipt.darkness}`, r.darknessHelp)}
          <input type="range" min={1} max={5} step={1} value={config.receipt.darkness}
            onChange={(e) => set('receipt_darkness', e.target.value)} className="w-full mt-2 accent-indigo-600" />
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          {label(r.feedLines || 'Blank lines after the receipt')}
          <input type="number" min={0} max={MAX_FEED_LINES} value={settings.receipt_feed_lines ?? '3'}
            onChange={(e) => set('receipt_feed_lines', e.target.value)} className={`${inputClass} mt-1.5`} />
        </label>
        <div>
          {label(r.copies || 'Copies')}
          <div className="mt-1.5">
            {choices('receipt_copies', Array.from({ length: MAX_COPIES }, (_, i) => String(i + 1)), (v) => v)}
          </div>
        </div>
      </div>
      <ToggleRow label={r.autoPrint || 'Print automatically after each sale'} {...flag('receipt_auto_print')} />
    </div>
  );
}
