import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';

export default function SettingsPage() {
  const { storeId } = useOutletContext();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadBakongCredential();
  }, [load, loadBakongCredential]);

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

  const keys = Object.keys(settings).sort();

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-semibold text-[var(--text-h)] mb-4">Store settings</h1>

      {message && <p className="text-sm text-slate-600 mb-3">{message}</p>}

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
    </div>
  );
}
