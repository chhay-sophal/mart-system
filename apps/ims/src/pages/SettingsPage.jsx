import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { STORE_ICON_KEY, resizeImageToDataUrl } from '../lib/storeIcon';
import OnlinePosImport from '../components/OnlinePosImport.jsx';

// Synced to every POS terminal in the store (read-only there once paired),
// so they get proper inputs below instead of the free-form key/value list.
const POS_SYNCED_KEYS = ['main_currency', 'locale', 'exchange_rate'];
const POS_SYNCED_DEFAULTS = { main_currency: 'USD', locale: 'km', exchange_rate: '4100' };

const inputClass ='flex-1 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm';
const saveButtonClass = 'text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5 disabled:opacity-60';

export default function SettingsPage() {
  const { storeId } = useOutletContext();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // Store profile lives on the Store row itself (name/address/phone), not in
  // StoreSetting, so it has its own load/save against PATCH /api/stores/:id.
  const [profile, setProfile] = useState({ name: '', address: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  // undefined = untouched, so saving the profile doesn't rewrite the icon (and
  // bump its updatedAt, which would re-send it to every terminal).
  const [pendingIcon, setPendingIcon] = useState(undefined);

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
      setProfile({ name: store.name ?? '', address: store.address ?? '', phone: store.phone ?? '' });
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
      await apiClient.patch(`/api/stores/${storeId}`, {
        name: profile.name.trim(),
        address: profile.address.trim() || null,
        phone: profile.phone.trim() || null,
      });
      if (pendingIcon !== undefined) {
        const res = await apiClient.put(`/api/stores/${storeId}/settings`, { settings: { [STORE_ICON_KEY]: pendingIcon } });
        setSettings(res.settings ?? settings);
        setPendingIcon(undefined);
      }
      setProfileMessage('Saved. POS terminals pick this up on their next sync.');
    } catch {
      setProfileMessage('Failed to save.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleIconFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again after a remove
    if (!file) return;
    try {
      setPendingIcon(await resizeImageToDataUrl(file));
    } catch (err) {
      setProfileMessage(err.message);
    }
  }

  const storeIcon = pendingIcon ?? settings[STORE_ICON_KEY] ?? '';

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
      // The icon saves with the profile card; rewriting it here would bump its
      // updatedAt and re-send it to every terminal for nothing.
      // eslint-disable-next-line no-unused-vars
      const { [STORE_ICON_KEY]: _icon, ...rest } = settings;
      await apiClient.put(`/api/stores/${storeId}/settings`, { settings: rest });
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
    .filter((key) => !POS_SYNCED_KEYS.includes(key) && key !== STORE_ICON_KEY)
    .sort();

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold text-[var(--text-h)] mb-4">Store settings</h1>

      {message && <p className="text-sm text-slate-600 mb-3">{message}</p>}

      <div className="bg-white border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-h)]">Store profile</h2>
        <p className="text-xs text-slate-500">Shown on POS terminals and receipts.</p>
        <div className="flex items-center gap-3">
          <label className="w-32 text-sm text-slate-600 shrink-0">Shop image</label>
          <div className="w-14 h-14 rounded-lg border border-[var(--border)] bg-slate-50 overflow-hidden flex items-center justify-center shrink-0">
            {storeIcon ? (
              <img src={storeIcon} alt="Shop" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs text-slate-400">None</span>
            )}
          </div>
          <label className="text-sm font-medium text-[var(--accent)] cursor-pointer">
            Upload
            <input type="file" accept="image/*" className="hidden" onChange={handleIconFile} />
          </label>
          {storeIcon && (
            <button type="button" onClick={() => setPendingIcon('')} className="text-sm text-slate-500 hover:text-red-600">
              Remove
            </button>
          )}
        </div>
        {[
          { key: 'name', label: 'Shop name', placeholder: 'My Store' },
          { key: 'address', label: 'Address', placeholder: 'Village, Commune, District, Province' },
          { key: 'phone', label: 'Phone', placeholder: '012 345 678' },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="flex items-center gap-3">
            <label className="w-32 text-sm text-slate-600 shrink-0">{label}</label>
            <input
              value={profile[key]}
              placeholder={placeholder}
              onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
              className={inputClass}
            />
          </div>
        ))}
        <div className="flex items-center justify-end gap-3">
          {profileMessage && <p className="text-xs text-slate-600">{profileMessage}</p>}
          <button onClick={handleSaveProfile} disabled={profileSaving || !profile.name.trim()} className={saveButtonClass}>
            {profileSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-h)]">Currency &amp; language</h2>
        <p className="text-xs text-slate-500">Applied to every POS terminal in this store.</p>
        <div className="flex items-center gap-3">
          <label className="w-32 text-sm text-slate-600 shrink-0">Main currency</label>
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
          <label className="w-32 text-sm text-slate-600 shrink-0">Main language</label>
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
          <label className="w-32 text-sm text-slate-600 shrink-0">Exchange rate</label>
          <input
            type="number"
            min="1"
            value={posSynced.exchange_rate}
            onChange={(e) => setSettings({ ...settings, exchange_rate: e.target.value })}
            className={inputClass}
          />
          <span className="text-xs text-slate-500 shrink-0">KHR per 1 USD</span>
        </div>
        <div className="flex items-center justify-end gap-3">
          {posSyncedMessage && <p className="text-xs text-slate-600">{posSyncedMessage}</p>}
          <button onClick={handleSavePosSynced} disabled={posSyncedSaving || loading} className={saveButtonClass}>
            {posSyncedSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-h)]">Bakong KHQR</h2>
        <p className="text-xs text-slate-500">
          The email registered with this store's Bakong merchant account. Used to mint the token that lets POS
          terminals generate KHQR codes and check payment status — never shown again once saved.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="email"
            placeholder="owner@yourstore.com"
            value={bakongEmail}
            onChange={(e) => setBakongEmail(e.target.value)}
            className="flex-1 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
          />
          <button
            onClick={handleSaveBakongEmail}
            disabled={bakongSaving || !bakongEmail}
            className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5 disabled:opacity-60"
          >
            {bakongSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Status: {bakongHasToken ? 'connected (token cached)' : 'registered, not yet used'}
        </p>
        {bakongMessage && <p className="text-xs text-slate-600">{bakongMessage}</p>}
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl p-5 space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            {keys.map((key) => (
              <div key={key} className="flex items-center gap-3">
                <label className="w-40 text-sm text-slate-600 shrink-0">{key}</label>
                <input
                  value={settings[key]}
                  onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                  className="flex-1 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            ))}

            <div className="flex items-center gap-3 pt-3 border-t border-[var(--border)]">
              <input
                placeholder="new_setting_key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-40 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm shrink-0"
              />
              <input
                placeholder="value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="flex-1 border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm"
              />
              <button onClick={addSetting} className="text-sm font-medium text-[var(--accent)]">
                Add
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5 disabled:opacity-60"
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
