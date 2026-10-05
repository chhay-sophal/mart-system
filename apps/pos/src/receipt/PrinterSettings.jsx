import { useEffect, useState } from 'react';
import { Printer, RefreshCw, Inbox } from 'lucide-react';
import { useToast } from '../Toast';
import { listPrinters, openCashDrawer, printReceiptDirect, printerConfig, sampleInvoice, TCP_PREFIX } from './thermalPrinter';

const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);
const NETWORK = '__network__'; // the select's "network printer" choice

const errorText = (err) => (typeof err === 'string' ? err : err?.message) || String(err);

/**
 * Settings > Printer (per register). Edits the receipt_* / cash_drawer_*
 * settings in the parent form; test buttons use the values as shown, so a
 * printer can be tried before saving.
 */
export default function PrinterSettings({ settings, setSettings, p, locale, ToggleRow, inputClass }) {
  const notify = useToast();
  const [printers, setPrinters] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);

  const set = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const name = settings.receipt_printer_name || '';
  const isNetwork = name.startsWith(TCP_PREFIX);
  const direct = settings.receipt_printer_mode === 'escpos';

  const refresh = () => {
    setPrinters(null);
    listPrinters()
      .then(setPrinters)
      .catch((err) => {
        setPrinters([]);
        notify((p.failed || 'Printer problem: {error}').replace('{error}', errorText(err)));
      });
  };
  // Mount-once: refresh isn't memoized, so listing it would refire every render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (action) => {
    setBusy(true);
    try {
      await action(printerConfig(settings));
      notify(p.testSent || 'Sent to the printer.', 'success');
    } catch (err) {
      notify((p.failed || 'Printer problem: {error}').replace('{error}', errorText(err)));
    }
    setBusy(false);
  };
  const testPrint = () =>
    run((config) =>
      printReceiptDirect(
        sampleInvoice({ storeName: settings.store_name, storeAddress: settings.store_address, storePhone: settings.store_phone }),
        locale,
        config,
      ),
    );

  const option = (selected) =>
    `py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700'}`;
  // A saved printer that's no longer installed still shows, so it isn't silently dropped.
  const choices = printers && name && !isNetwork && !printers.includes(name) ? [name, ...printers] : printers || [];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{p.mode || 'How receipts print'}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-2">{p.modeHelp}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={option(!direct)} onClick={() => set('receipt_printer_mode', 'system')}>
            {p.modeSystem || 'Windows print dialog'}
          </button>
          <button type="button" className={option(direct)} onClick={() => set('receipt_printer_mode', 'escpos')}>
            {p.modeDirect || 'Thermal printer (ESC/POS)'}
          </button>
        </div>
      </div>

      {direct && !IS_TAURI && <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{p.desktopOnly}</p>}

      {direct && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{p.printer || 'Printer'}</label>
              <button type="button" onClick={refresh} disabled={printers === null}
                className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50">
                <RefreshCw size={11} className={printers === null ? 'animate-spin' : ''} /> {p.refresh || 'Refresh'}
              </button>
            </div>
            <select
              value={isNetwork ? NETWORK : name}
              onChange={(e) => set('receipt_printer_name', e.target.value === NETWORK ? TCP_PREFIX : e.target.value)}
              className={inputClass}
            >
              <option value="">{p.choosePrinter || 'Choose a printer…'}</option>
              {choices.map((printer) => <option key={printer} value={printer}>{printer}</option>)}
              <option value={NETWORK}>{p.networkPrinter || 'Network printer (IP address)'}</option>
            </select>
            {printers?.length === 0 && !isNetwork && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{p.noPrinters}</p>
            )}
            {isNetwork && (
              <input type="text" value={name.slice(TCP_PREFIX.length)}
                onChange={(e) => set('receipt_printer_name', TCP_PREFIX + e.target.value.trim())}
                className={`${inputClass} mt-2 font-mono`} placeholder="192.168.1.100" aria-label={p.networkAddress}
                title={p.networkAddress} />
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">{p.paperWidth || 'Paper width'}</p>
            <div className="grid grid-cols-2 gap-2">
              {['58', '80'].map((mm) => (
                <button key={mm} type="button" className={option((settings.receipt_paper_width || '58') === mm)}
                  onClick={() => set('receipt_paper_width', mm)}>
                  {mm} mm
                </button>
              ))}
            </div>
          </div>

          <ToggleRow
            label={p.autoCut || 'Cut the paper after printing'}
            checked={settings.receipt_auto_cut !== 'false'}
            onChange={(on) => set('receipt_auto_cut', on ? 'true' : 'false')}
          />
          <ToggleRow
            label={p.openDrawer || 'Open the cash drawer after cash sales'}
            help={p.openDrawerHelp}
            checked={settings.cash_drawer_on_cash === 'true'}
            onChange={(on) => set('cash_drawer_on_cash', on ? 'true' : 'false')}
          />

          <div className="flex items-center gap-2">
            <button type="button" onClick={testPrint} disabled={busy || !printerConfig(settings).direct}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <Printer size={12} /> {p.testPrint || 'Test print'}
            </button>
            <button type="button" onClick={() => run(openCashDrawer)} disabled={busy || !printerConfig(settings).direct}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <Inbox size={12} /> {p.testDrawer || 'Open drawer'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
