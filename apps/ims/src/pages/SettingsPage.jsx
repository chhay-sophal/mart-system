import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import OnlinePosImport from '../components/OnlinePosImport.jsx';

// Synced to every POS terminal in the store (read-only there once paired),
// so they get proper inputs below instead of the free-form key/value list.
const POS_SYNCED_KEYS = ['main_currency', 'locale', 'exchange_rate'];
const POS_SYNCED_DEFAULTS = { main_currency: 'USD', locale: 'km', exchange_rate: '4100' };
// Left over from when the shop image synced from IMS; it's set per register now
// (issue #5), so it's kept out of the free-form list.
const LEGACY_HIDDEN_KEYS = ['store_icon'];

const inputClass ='flex-1 border border-[var(--border)] rounded-lg px-3 h-9 text-sm';
const saveButtonClass = 'text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 h-9 inline-flex items-center justify-center disabled:opacity-60 cursor-pointer';

export default function SettingsPage() {
  const { storeId } = useOutletContext();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // The store's name in IMS (store picker, reports). What customers see -- shop
  // name, image, address, phone -- is set on each register (issue #5).
  const [storeName, setStoreName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');

  const [posSyncedSaving, setPosSyncedSaving] = useState(false);
  const [posSyncedMessage, setPosSyncedMessage] = useState('');

  // Bakong registered email lives in its own model (BakongCredential), not the
  // generic StoreSetting table, since a cached bearer token also lives there
  // and must never ride along on a response any staff role can read.
  const [bakongEmail, setBakongEmail] = useState('');
  const [bakongHasToken, setBakongHasToken] = useState(false);
  const [bakongSaving, setBakongSaving] = useState(false);
  const [bakongMessage, setBakongMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/stores/${storeId}/settings`);
      setSettings(res.settings ?? {});
    } catch {
      setMessage('Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  const loadBakongCredential = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/stores/${storeId}/bakong-credential`);
      setBakongEmail(res.registeredEmail ?? '');
      setBakongHasToken(Boolean(res.hasToken));
    } catch {
      // Non-fatal — the generic settings above still load fine either way.
    }
  }, [storeId]);

  const loadProfile = useCallback(async () => {
    try {
      const store = await apiClient.get(`/api/stores/${storeId}`);
      setStoreName(store.name ?? '');
    } catch {
      setProfileMessage('Failed to load store profile.');
    }
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadBakongCredential();
    loadProfile();
  }, [load, loadBakongCredential, loadProfile]);

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileMessage('');
    try {
      await apiClient.patch(`/api/stores/${storeId}`, { name: storeName.trim() });
      setProfileMessage('Saved.');
    } catch {
      setProfileMessage('Failed to save.');
    } finally {
      setProfileSaving(false);
    }
  }

  const posSynced = { ...POS_SYNCED_DEFAULTS, ...settings };

  async function handleSavePosSynced() {
    setPosSyncedSaving(true);
    setPosSyncedMessage('');
    try {
      const values = Object.fromEntries(POS_SYNCED_KEYS.map((key) => [key, String(posSynced[key])]));
      const res = await apiClient.put(`/api/stores/${storeId}/settings`, { settings: values });
      setSettings(res.settings ?? settings);
      setPosSyncedMessage('Saved. POS terminals pick this up on their next sync.');
    } catch {
      setPosSyncedMessage('Failed to save — check the exchange rate is a positive number.');
    } finally {
      setPosSyncedSaving(false);
    }
  }

  async function handleSaveBakongEmail() {
    setBakongSaving(true);
    setBakongMessage('');
    try {
      const res = await apiClient.put(`/api/stores/${storeId}/bakong-credential`, { registeredEmail: bakongEmail });
      setBakongHasToken(Boolean(res.hasToken));
      setBakongMessage('Saved.');
    } catch {
      setBakongMessage('Failed to save.');
    } finally {
      setBakongSaving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      await apiClient.put(`/api/stores/${storeId}/settings`, { settings });
      setMessage('Saved.');
    } catch {
      setMessage('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  function addSetting() {
    if (!newKey.trim()) return;
    setSettings({ ...settings, [newKey.trim()]: newValue });
    setNewKey('');
    setNewValue('');
  }

  const keys = Object.keys(settings)
    .filter((key) => !POS_SYNCED_KEYS.includes(key) && !LEGACY_HIDDEN_KEYS.includes(key))
    .sort();

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold text-[var(--text-h)] mb-4">Store settings</h1>

      {message && <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{message}</p>}

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-h)]">Store profile</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          How this store is named in IMS. The shop name, image, address and phone customers see are set on each
          register, in POS Settings.
        </p>
        <div className="flex items-center gap-3">
          <label className="w-32 text-sm text-slate-600 dark:text-slate-300 shrink-0">Store name</label>
          <input value={storeName} placeholder="My Store" onChange={(e) => setStoreName(e.target.value)} className={inputClass} />
        </div>
        <div className="flex items-center justify-end gap-3">
          {profileMessage && <p className="text-xs text-slate-600 dark:text-slate-300">{profileMessage}</p>}
          <button onClick={handleSaveProfile} disabled={profileSaving || !storeName.trim()} className={saveButtonClass}>
            {profileSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-h)]">Currency &amp; language</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Applied to every POS terminal in this store.</p>
        <div className="flex items-center gap-3">
          <label className="w-32 text-sm text-slate-600 dark:text-slate-300 shrink-0">Main currency</label>
          <select
            value={posSynced.main_currency}
            onChange={(e) => setSettings({ ...settings, main_currency: e.target.value })}
            className={inputClass}
          >
            <option value="USD">US Dollar (USD)</option>
            <option value="KHR">Khmer Riel (KHR)</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="w-32 text-sm text-slate-600 dark:text-slate-300 shrink-0">Main language</label>
          <select
            value={posSynced.locale}
            onChange={(e) => setSettings({ ...settings, locale: e.target.value })}
            className={inputClass}
          >
            <option value="km">ភាសាខ្មែរ (Khmer)</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="w-32 text-sm text-slate-600 dark:text-slate-300 shrink-0">Exchange rate</label>
          <input
            type="number"
            min="1"
            value={posSynced.exchange_rate}
            onChange={(e) => setSettings({ ...settings, exchange_rate: e.target.value })}
            className={inputClass}
          />
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">KHR per 1 USD</span>
        </div>
        <div className="flex items-center justify-end gap-3">
          {posSyncedMessage && <p className="text-xs text-slate-600 dark:text-slate-300">{posSyncedMessage}</p>}
          <button onClick={handleSavePosSynced} disabled={posSyncedSaving || loading} className={saveButtonClass}>
            {posSyncedSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-h)]">Bakong KHQR</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The email registered with this store's Bakong merchant account. Used to mint the token that lets POS
          terminals generate KHQR codes and check payment status — never shown again once saved.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="email"
            placeholder="owner@yourstore.com"
            value={bakongEmail}
            onChange={(e) => setBakongEmail(e.target.value)}
            className="flex-1 border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
          />
          <button
            onClick={handleSaveBakongEmail}
            disabled={bakongSaving || !bakongEmail}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 h-9 inline-flex items-center justify-center disabled:opacity-60 cursor-pointer"
          >
            {bakongSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Status: {bakongHasToken ? 'connected (token cached)' : 'registered, not yet used'}
        </p>
        {bakongMessage && <p className="text-xs text-slate-600 dark:text-slate-300">{bakongMessage}</p>}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-5 space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : (
          <>
            {keys.map((key) => (
              <div key={key} className="flex items-center gap-3">
                <label className="w-40 text-sm text-slate-600 dark:text-slate-300 shrink-0">{key}</label>
                <input
                  value={settings[key]}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                  className="flex-1 border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
                />
              </div>
            ))}

            <div className="flex items-center gap-3 pt-3 border-t border-[var(--border)]">
              <input
                placeholder="new_setting_key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-40 border border-[var(--border)] rounded-lg px-3 h-9 text-sm shrink-0"
              />
              <input
                placeholder="value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="flex-1 border border-[var(--border)] rounded-lg px-3 h-9 text-sm"
              />
              <button onClick={addSetting} className="text-sm font-medium text-[var(--accent)] cursor-pointer">
                Add
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 h-9 inline-flex items-center justify-center disabled:opacity-60 cursor-pointer"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mt-4">
        <OnlinePosImport
          storeId={storeId}
          onImported={() => {
            load();
            loadProfile();
          }}
        />
      </div>
    </div>
  );
}
