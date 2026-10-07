import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { useToast } from '../Toast';
import { openCashDrawer, printerConfig } from './thermalPrinter';

const errorText = (err) => (typeof err === 'string' ? err : err?.message) || String(err);
// Drawer PINs are exactly 4 digits, same rule as staff PINs (StaffPage.jsx).
const onlyDigits = (value) => value.replace(/[^0-9]/g, '').slice(0, 4);

/**
 * Settings > Printer (per register). Edits the receipt_* / cash_drawer_*
 * settings in the parent form; test buttons use the values as shown, so a
 * printer can be tried before saving.
 */
export default function CashDrawerSettings({ settings, setSettings, p, ToggleRow, inputClass }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);

  const set = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const direct = settings.receipt_printer_mode === 'escpos';

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

  return (
    <div className="space-y-4">
      {direct && (
        <>
          <ToggleRow
            label={p.openDrawer || 'Open the cash drawer after cash sales'}
            help={p.openDrawerHelp}
            checked={settings.cash_drawer_on_cash === 'true'}
            onChange={(on) => set('cash_drawer_on_cash', on ? 'true' : 'false')}
          />

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => run(openCashDrawer)} disabled={busy || !printerConfig(settings).direct}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <Inbox size={12} /> {p.testDrawer || 'Open drawer'}
            </button>
          </div>

          {/* Admin-set (Settings is admin-only already): require a PIN before
              a manual drawer open -- separate from the above, which is about
              opening it automatically after a cash sale. */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-4">
            <ToggleRow
              label={p.requireDrawerPin || 'Require a PIN to open the drawer'}
              help={p.requireDrawerPinHelp || 'Asks for this PIN before the register opens the drawer outside of a cash sale.'}
              checked={settings.cash_drawer_pin_enabled === 'true'}
              onChange={(on) => set('cash_drawer_pin_enabled', on ? 'true' : 'false')}
            />
            {settings.cash_drawer_pin_enabled === 'true' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                  {p.drawerPin || 'Drawer PIN (4 digits)'}
                </label>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  title="Exactly 4 digits"
                  maxLength={4}
                  placeholder="1234"
                  value={settings.cash_drawer_pin || ''}
                  onChange={(e) => set('cash_drawer_pin', onlyDigits(e.target.value))}
                  className={inputClass}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
