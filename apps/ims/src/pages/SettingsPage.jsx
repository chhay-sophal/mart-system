import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, Check, ChevronRight, Plus } from 'lucide-react';
import { apiClient } from '../lib/apiClient';
import { queryKeys } from '../lib/queryClient';
import { fmtKhr } from '../lib/orderTotals';
import { useAuth } from '../auth/AuthContext.jsx';
import OnlinePosImport from '../components/OnlinePosImport.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt } from '../i18n/translate';

// Synced to every POS terminal in the store (read-only there once paired),
// so they get proper inputs below instead of the free-form key/value list.
const POS_SYNCED_KEYS = ['main_currency', 'locale', 'exchange_rate'];
const POS_SYNCED_DEFAULTS = { main_currency: 'USD', locale: 'km', exchange_rate: '4100' };
// Left over from when the shop image synced from IMS; it's set per register now
// (issue #5), so it's kept out of the free-form list.
const LEGACY_HIDDEN_KEYS = ['store_icon'];
const isCustomKey = (key) => !POS_SYNCED_KEYS.includes(key) && !LEGACY_HIDDEN_KEYS.includes(key);

const inputClass = 'w-full border border-[var(--border)] rounded-lg px-3 h-9 text-sm bg-white dark:bg-slate-800';
const muted = 'text-slate-500 dark:text-slate-400';

/** A settings card: title + hint (and an optional badge) on top, its fields, and a footer for saving. */
function Section({ title, hint, badge, footer, children }) {
  return (
    <section className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-5 pt-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-h)]">{title}</h2>
          {hint && <p className={`text-xs mt-1 ${muted}`}>{hint}</p>}
        </div>
        {badge}
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-[var(--border)] bg-slate-50 dark:bg-slate-900/40 flex items-center justify-end gap-3">
          {footer}
        </div>
      )}
    </section>
  );
}

/** A label beside its control on wider screens, above it on narrow ones. */
function Field({ label, htmlFor, help, error, children }) {
  return (
    <div className="grid sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 sm:items-start">
      <label htmlFor={htmlFor} className="text-sm text-slate-600 dark:text-slate-300 sm:pt-2">
        {label}
      </label>
      <div>
        {children}
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{error}</p>
        ) : (
          help && <p className={`text-xs mt-1.5 ${muted}`}>{help}</p>
        )}
      </div>
    </div>
  );
}

/** A small set of mutually exclusive choices, shown side by side. */
function Segmented({ value, onChange, options, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 bg-slate-100 dark:bg-slate-700 p-0.5 rounded-lg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 h-8 rounded-md text-sm transition-colors cursor-pointer ${
            value === o.value
              ? 'bg-white dark:bg-slate-900 text-[var(--accent)] font-medium shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The footer's Save button and what happened: an error stays until the next
 * save; "Saved" shows until the section is edited again, when it becomes
 * "Unsaved changes". Save is only enabled when there's something to save.
 */
function SaveBar({ dirty, saving, status, canSave = true, onSave, label }) {
  const { t } = useLocale();
  const shown = status?.type === 'error' || (status && !dirty) ? status : null;
  return (
    <>
      {shown ? (
        <p
          role="status"
          className={`flex items-center gap-1.5 text-xs mr-auto ${shown.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
        >
          {shown.type === 'error' ? <AlertCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          {shown.text}
        </p>
      ) : (
        dirty && (
          <p className="flex items-center gap-1.5 text-xs mr-auto text-amber-600 dark:text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
            {t.settings.unsaved}
          </p>
        )
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !dirty || !canSave}
        className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 h-9 inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-default cursor-pointer"
      >
        {saving ? t.common.saving : (label ?? t.common.save)}
      </button>
    </>
  );
}

function StatusBadge({ tone, children }) {
  const tones = {
    good: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
    neutral: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700',
    warn: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  };
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 h-6 ${tones[tone]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export default function SettingsPage() {
  const { storeId } = useOutletContext();
  const { stores, reloadStores } = useAuth();
  const { t } = useLocale();
  const [settings, setSettings] = useState({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // The store's name in IMS (store picker, reports). What customers see -- shop
  // name, image, address, phone -- is set on each register (issue #5).
  const [storeName, setStoreName] = useState('');

  // Per section: which save is running, and how the last one went
  // ({ type: 'success' | 'error', text }).
  const [saving, setSaving] = useState({});
  const [status, setStatus] = useState({});
  const run = async (section, fn, successText, errorText) => {
    setSaving((prev) => ({ ...prev, [section]: true }));
    setStatus((prev) => ({ ...prev, [section]: null }));
    try {
      await fn();
      setStatus((prev) => ({ ...prev, [section]: { type: 'success', text: successText } }));
    } catch {
      setStatus((prev) => ({ ...prev, [section]: { type: 'error', text: errorText } }));
    } finally {
      setSaving((prev) => ({ ...prev, [section]: false }));
    }
  };

  // Cached (lib/queryClient.js), so coming back to this page shows the last
  // values at once. storeSettings is shared with the Products page.
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: queryKeys.storeSettings(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/settings`),
    enabled: Boolean(storeId),
  });
  const bakongQuery = useQuery({
    queryKey: queryKeys.bakongCredential(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}/bakong-credential`),
    enabled: Boolean(storeId),
  });
  const storeQuery = useQuery({
    queryKey: queryKeys.store(storeId),
    queryFn: () => apiClient.get(`/api/stores/${storeId}`),
    enabled: Boolean(storeId),
  });
  const loading = settingsQuery.isPending;

  // The inputs below are edited locally, so they're filled from the cache
  // once per store (and again after an import) -- never on a background
  // refresh, which would wipe out whatever is being typed. Done during
  // render, React's pattern for state derived from a changing input.
  const [seeded, setSeeded] = useState({ settings: null, store: null });
  if (settingsQuery.data && seeded.settings !== storeId) {
    setSettings(settingsQuery.data.settings ?? {});
    setSeeded((prev) => ({ ...prev, settings: storeId }));
  }
  if (storeQuery.data && seeded.store !== storeId) {
    setStoreName(storeQuery.data.name ?? '');
    setSeeded((prev) => ({ ...prev, store: storeId }));
  }

  // What's saved, to tell which sections have unsaved edits.
  const savedSettings = settingsQuery.data?.settings ?? {};
  const savedPos = { ...POS_SYNCED_DEFAULTS, ...savedSettings };
  const posSynced = { ...POS_SYNCED_DEFAULTS, ...settings };
  const customKeys = Object.keys(settings).filter(isCustomKey).sort();

  const profileDirty = storeName.trim() !== (storeQuery.data?.name ?? '');
  const posDirty = POS_SYNCED_KEYS.some((key) => String(posSynced[key]) !== String(savedPos[key]));
  const customDirty = customKeys.some((key) => settings[key] !== savedSettings[key]);

  const rate = Number(posSynced.exchange_rate);
  const rateValid = String(posSynced.exchange_rate).trim() !== '' && Number.isFinite(rate) && rate > 0;

  // An import changes settings and the store behind this page's back: wait
  // for fresh copies, then refill the inputs from them.
  async function handleImported() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.storeSettings(storeId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.store(storeId) }),
    ]);
    setSeeded((prev) => ({ ...prev, settings: null, store: null }));
    reloadStores();
  }

  const saveProfile = () =>
    run(
      'profile',
      async () => {
        const updated = await apiClient.patch(`/api/stores/${storeId}`, { name: storeName.trim() });
        queryClient.setQueryData(queryKeys.store(storeId), updated);
        setStoreName(updated.name ?? storeName.trim());
        reloadStores(); // the store picker shows the name too
      },
      t.settings.saved,
      t.settings.saveFailed
    );

  // Each section saves only its own keys, so saving one never sends another
  // section's unsaved edits along with it.
  async function putSettings(values) {
    const res = await apiClient.put(`/api/stores/${storeId}/settings`, { settings: values });
    if (res.settings) {
      queryClient.setQueryData(queryKeys.storeSettings(storeId), res);
      setSettings((prev) => ({ ...prev, ...Object.fromEntries(Object.keys(values).map((key) => [key, res.settings[key]])) }));
    } else {
      await queryClient.invalidateQueries({ queryKey: queryKeys.storeSettings(storeId) });
    }
  }

  const savePos = () =>
    run(
      'pos',
      () => putSettings(Object.fromEntries(POS_SYNCED_KEYS.map((key) => [key, String(posSynced[key]).trim()]))),
      t.settings.pos.saved,
      t.settings.pos.saveFailed
    );

  const saveCustom = () =>
    run(
      'custom',
      () => putSettings(Object.fromEntries(customKeys.map((key) => [key, settings[key]]))),
      t.settings.saved,
      t.settings.saveSettingsFailed
    );

  function addSetting() {
    if (!newKey.trim()) return;
    setSettings({ ...settings, [newKey.trim()]: newValue });
    setNewKey('');
    setNewValue('');
  }

  // Bakong: the registered email is a server setting (BAKONG_REGISTERED_EMAIL),
  // never shown or edited here -- only whether it's set (and where), masked,
  // and whether a token has been obtained with it.
  const bakong = bakongQuery.data;
  const bakongState = !bakong?.configured ? 'notSetUp' : bakong.hasToken ? 'connected' : 'notUsed';
  const bakongBadge = {
    connected: <StatusBadge tone="good">{t.settings.bakong.statusConnected}</StatusBadge>,
    notUsed: <StatusBadge tone="neutral">{t.settings.bakong.statusNotUsed}</StatusBadge>,
    notSetUp: <StatusBadge tone="warn">{t.settings.bakong.statusNotSetUp}</StatusBadge>,
  }[bakongState];

  const currentStoreName = storeQuery.data?.name ?? stores.find((s) => s.id === storeId)?.name ?? '';

  return (
    // A form, not a table like the other pages: a readable column, centered.
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--text-h)]">{t.settings.title}</h1>
        {currentStoreName && <p className={`text-xs mt-0.5 ${muted}`}>{fmt(t.settings.subtitle, { store: currentStoreName })}</p>}
      </div>

      {settingsQuery.isError && (
        <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={16} aria-hidden="true" />
          {t.settings.loadFailed}
        </p>
      )}

      <Section
        title={t.settings.profile.title}
        hint={t.settings.profile.hint}
        footer={
          <SaveBar
            dirty={profileDirty}
            saving={saving.profile}
            status={storeQuery.isError ? { type: 'error', text: t.settings.profile.loadFailed } : status.profile}
            canSave={Boolean(storeName.trim())}
            onSave={saveProfile}
          />
        }
      >
        <Field label={t.settings.profile.storeName} htmlFor="store-name">
          <input
            id="store-name"
            value={storeName}
            placeholder={t.settings.profile.storeNamePlaceholder}
            onChange={(e) => setStoreName(e.target.value)}
            className={inputClass}
          />
        </Field>
      </Section>

      <Section
        title={t.settings.pos.title}
        hint={t.settings.pos.hint}
        footer={<SaveBar dirty={posDirty} saving={saving.pos} status={status.pos} canSave={!loading && rateValid} onSave={savePos} />}
      >
        <Field label={t.settings.pos.mainCurrency}>
          <Segmented
            label={t.settings.pos.mainCurrency}
            value={posSynced.main_currency}
            onChange={(v) => setSettings({ ...settings, main_currency: v })}
            options={[
              { value: 'USD', label: t.settings.pos.usd },
              { value: 'KHR', label: t.settings.pos.khr },
            ]}
          />
        </Field>
        <Field label={t.settings.pos.mainLanguage}>
          <Segmented
            label={t.settings.pos.mainLanguage}
            value={posSynced.locale}
            onChange={(v) => setSettings({ ...settings, locale: v })}
            options={[
              { value: 'km', label: t.settings.pos.khmer },
              { value: 'en', label: t.settings.pos.english },
            ]}
          />
        </Field>
        <Field
          label={t.settings.pos.exchangeRate}
          htmlFor="exchange-rate"
          error={rateValid ? null : t.settings.pos.rateInvalid}
          help={fmt(t.settings.pos.ratePreview, { one: fmtKhr(rate), ten: fmtKhr(rate * 10) })}
        >
          <div className="relative max-w-56">
            <input
              id="exchange-rate"
              type="number"
              min="1"
              inputMode="decimal"
              value={posSynced.exchange_rate}
              onChange={(e) => setSettings({ ...settings, exchange_rate: e.target.value })}
              aria-invalid={!rateValid}
              className={`${inputClass} pr-28 tabular-nums ${rateValid ? '' : 'border-red-400 dark:border-red-500'}`}
            />
            <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none ${muted}`}>{t.settings.pos.perUsd}</span>
          </div>
        </Field>
      </Section>

      <Section
        title={t.settings.bakong.title}
        hint={t.settings.bakong.hint}
        badge={bakongQuery.isSuccess ? bakongBadge : null}
      >
        {bakongQuery.isError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{t.settings.loadFailed}</p>
        ) : (
          <Field label={t.settings.bakong.email} help={t.settings.bakong.statusHint[bakongState]}>
            <p className="text-sm text-[var(--text-h)] sm:pt-2">
              {!bakong
                ? t.common.loading
                : !bakong.configured
                  ? t.settings.bakong.notConfigured
                  : (bakong.source === 'server' ? t.settings.bakong.onServer : t.settings.bakong.onStore).replace('{email}', bakong.maskedEmail)}
            </p>
          </Field>
        )}
      </Section>

      <OnlinePosImport storeId={storeId} onImported={handleImported} />

      {/* Rarely needed, so folded away; opening it keeps any edits. */}
      <details className="group bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl overflow-hidden">
        <summary className="px-5 py-4 flex items-start gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <ChevronRight size={16} aria-hidden="true" className={`mt-0.5 shrink-0 transition-transform group-open:rotate-90 ${muted}`} />
          <span>
            <span className="block text-sm font-semibold text-[var(--text-h)]">{t.settings.custom.title}</span>
            <span className={`block text-xs mt-1 ${muted}`}>{t.settings.custom.hint}</span>
          </span>
          {customDirty && <span className="ml-auto w-2 h-2 mt-1.5 rounded-full bg-amber-500 shrink-0" title={t.settings.unsaved} />}
        </summary>
        <div className="px-5 pb-4 space-y-3">
          {loading ? (
            <p className={`text-sm ${muted}`}>{t.common.loading}</p>
          ) : customKeys.length === 0 ? (
            <p className={`text-sm ${muted}`}>{t.settings.custom.empty}</p>
          ) : (
            customKeys.map((key) => (
              <div key={key} className="grid sm:grid-cols-[12rem_1fr] gap-x-4 gap-y-1 sm:items-center">
                <label htmlFor={`setting-${key}`} className="text-xs font-mono text-slate-600 dark:text-slate-300 break-all">
                  {key}
                </label>
                <input
                  id={`setting-${key}`}
                  value={settings[key]}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                  className={inputClass}
                />
              </div>
            ))
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addSetting();
            }}
            className="grid sm:grid-cols-[12rem_1fr_auto] gap-2 pt-3 border-t border-[var(--border)]"
          >
            <input
              placeholder={t.settings.custom.keyPlaceholder}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              aria-label={t.settings.custom.keyPlaceholder}
              className={`${inputClass} font-mono`}
            />
            <input
              placeholder={t.settings.custom.valuePlaceholder}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              aria-label={t.settings.custom.valuePlaceholder}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={!newKey.trim()}
              className="text-sm font-medium border border-[var(--border)] rounded-lg px-3 h-9 inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-default cursor-pointer"
            >
              <Plus size={16} aria-hidden="true" />
              {t.common.add}
            </button>
          </form>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] bg-slate-50 dark:bg-slate-900/40 flex items-center justify-end gap-3">
          <SaveBar dirty={customDirty} saving={saving.custom} status={status.custom} canSave={!loading} onSave={saveCustom} label={t.settings.saveChanges} />
        </div>
      </details>
    </div>
  );
}
