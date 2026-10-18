import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  TENDER_PRESETS_USD_KEY, TENDER_PRESETS_KHR_KEY, TENDER_SECONDARY_ENABLED_KEY,
  DEFAULT_USD_PRESETS, DEFAULT_KHR_PRESETS, parseTenderPresets, serializeTenderPresets,
} from './tenderPresets';

function PresetList({ amounts, onChange, format, placeholder, addLabel }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n <= 0 || amounts.includes(n)) { setDraft(''); return; }
    onChange([...amounts, n].sort((a, b) => a - b));
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[1.75rem]">
        {amounts.length === 0 && <span className="text-xs text-slate-400 dark:text-slate-500">—</span>}
        {amounts.map((amount) => (
          <span key={amount} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200">
            {format(amount)}
            <button
              type="button"
              onClick={() => onChange(amounts.filter((a) => a !== amount))}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 hover:text-red-500 cursor-pointer"
              aria-label={`Remove ${format(amount)}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="number"
          min="0"
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="w-28 border border-slate-200 dark:border-slate-700 rounded-lg px-3 h-9 text-sm bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 h-9 inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
        >
          <Plus size={12} /> {addLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Settings > General > Tendered Amount Presets: per-currency quick amounts
 * the checkout's cash tender fields offer as tap-to-fill chips, so the
 * cashier isn't always typing the exact figure in. The order's own total is
 * always offered too (as "Exact"), computed at checkout, not configured here.
 */
export default function TenderPresets({ settings, setSettings, q, ToggleRow }) {
  // const enabled = settings[TENDER_PRESETS_ENABLED_KEY] !== 'false';
  const usd = parseTenderPresets(settings[TENDER_PRESETS_USD_KEY], DEFAULT_USD_PRESETS);
  const khr = parseTenderPresets(settings[TENDER_PRESETS_KHR_KEY], DEFAULT_KHR_PRESETS);
  const secondaryEnabled = settings[TENDER_SECONDARY_ENABLED_KEY] !== 'false';

  return (
    <div className="space-y-4">
      {/* <p className="text-xs text-slate-400 dark:text-slate-500">
        {q.exactNote || 'An "Exact" chip matching the current sale\'s total is always shown too — it isn\'t part of the list below.'}
      </p> */}
      <ToggleRow
        label={q.showSecondary || 'Show the secondary currency tender field at checkout'}
        help={q.showSecondaryHelp || "Under the main currency's tendered amount — the cashier can still take cash in the store's other currency. Turn off to only ever show the main currency."}
        checked={secondaryEnabled}
        onChange={(on) => setSettings((prev) => ({ ...prev, [TENDER_SECONDARY_ENABLED_KEY]: on ? 'true' : 'false' }))}
      />
      <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{q.khrLabel || 'KHR presets'}</label>
          <PresetList
            amounts={khr}
            onChange={(next) => setSettings((prev) => ({ ...prev, [TENDER_PRESETS_KHR_KEY]: serializeTenderPresets(next) }))}
            format={(n) => `${Number(n).toLocaleString()} ៛`}
            placeholder="e.g. 5000"
            addLabel={q.add || 'Add'}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{q.usdLabel || 'USD presets'}</label>
          <PresetList
            amounts={usd}
            onChange={(next) => setSettings((prev) => ({ ...prev, [TENDER_PRESETS_USD_KEY]: serializeTenderPresets(next) }))}
            format={(n) => `$${Number(n).toFixed(2)}`}
            placeholder="e.g. 10"
            addLabel={q.add || 'Add'}
          />
        </div>
      </div>
    </div>
  );
}
