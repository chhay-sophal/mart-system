import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../lib/apiClient';
import { useAuth } from '../auth/AuthContext.jsx';

const DAYS = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];

// Per-day editor state. "24h" maps to 00:00–24:00 on save; a closing time
// earlier than the opening time means the day runs past midnight.
const DEFAULT_DAY = { mode: 'open', open: '07:00', close: '22:00' };

function toEditorDay(day) {
  if (!day) return { ...DEFAULT_DAY, mode: 'closed' };
  if (day.open === '00:00' && day.close === '24:00') return { ...DEFAULT_DAY, mode: '24h' };
  return { mode: 'open', open: day.open, close: day.close };
}

function toApiDay(day) {
  if (day.mode === 'closed') return null;
  if (day.mode === '24h') return { open: '00:00', close: '24:00' };
  return { open: day.open, close: day.close };
}

function toEditorHours(openingHours) {
  return Object.fromEntries(DAYS.map(([key]) => [key, openingHours ? toEditorDay(openingHours[key]) : { ...DEFAULT_DAY }]));
}

const parseCoord = (v) => (v.trim() === '' ? null : Number(v));

const inputClass = 'border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm';

/**
 * Name, contact, weekly hours and map pin for the current branch — what the
 * public storefront's branch finder shows. PATCHes /api/stores/:storeId (admin only).
 */
export default function BranchDetailsCard({ storeId }) {
  const { reloadStores } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const store = await apiClient.get(`/api/stores/${storeId}`);
      setForm({
        name: store.name,
        address: store.address ?? '',
        phone: store.phone ?? '',
        hoursListed: store.openingHours != null,
        hours: toEditorHours(store.openingHours),
        latitude: store.latitude?.toString() ?? '',
        longitude: store.longitude?.toString() ?? '',
      });
    } catch {
      setMessage('Failed to load branch details.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setDay = (key, patch) => setForm((f) => ({ ...f, hours: { ...f.hours, [key]: { ...f.hours[key], ...patch } } }));
  const copyMondayToAll = () =>
    setForm((f) => ({ ...f, hours: Object.fromEntries(DAYS.map(([key]) => [key, { ...f.hours.mon }])) }));

  const lat = form ? parseCoord(form.latitude) : null;
  const lng = form ? parseCoord(form.longitude) : null;
  const coordError =
    form &&
    ((lat === null) !== (lng === null)
      ? 'Enter both latitude and longitude, or leave both empty.'
      : (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) ||
          (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180))
        ? 'Latitude must be between -90 and 90, longitude between -180 and 180.'
        : '');
  const sameTimeDay =
    form && form.hoursListed && DAYS.find(([key]) => form.hours[key].mode === 'open' && form.hours[key].open === form.hours[key].close);

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      await apiClient.patch(`/api/stores/${storeId}`, {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        openingHours: form.hoursListed
          ? Object.fromEntries(DAYS.map(([key]) => [key, toApiDay(form.hours[key])]))
          : null,
        latitude: lat,
        longitude: lng,
      });
      await reloadStores();
      setMessage('Saved.');
    } catch {
      setMessage('Failed to save branch details.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) {
    return (
      <div className="bg-white border border-[var(--border)] rounded-xl p-5 mb-4">
        <p className="text-sm text-slate-400">{loading ? 'Loading…' : message}</p>
      </div>
    );
  }

  const canSave = form.name.trim() && !coordError && !sameTimeDay && !saving;

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-5 space-y-4 mb-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-h)]">Branch details</h2>
        <p className="text-xs text-slate-500">Shown to shoppers on the online storefront's branch finder.</p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-3">
          <span className="w-24 text-sm text-slate-600 shrink-0">Name</span>
          <input value={form.name} onChange={(e) => setField('name', e.target.value)} className={`flex-1 ${inputClass}`} />
        </label>
        <label className="flex items-center gap-3">
          <span className="w-24 text-sm text-slate-600 shrink-0">Address</span>
          <input
            value={form.address}
            onChange={(e) => setField('address', e.target.value)}
            placeholder="Street, district, city"
            className={`flex-1 ${inputClass}`}
          />
        </label>
        <label className="flex items-center gap-3">
          <span className="w-24 text-sm text-slate-600 shrink-0">Phone</span>
          <input
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value)}
            placeholder="012 345 678"
            className={`flex-1 ${inputClass}`}
          />
        </label>
      </div>

      <div className="space-y-2 pt-3 border-t border-[var(--border)]">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-h)]">
            <input type="checkbox" checked={form.hoursListed} onChange={(e) => setField('hoursListed', e.target.checked)} />
            List opening hours
          </label>
          {form.hoursListed && (
            <button type="button" onClick={copyMondayToAll} className="text-xs font-medium text-[var(--accent)]">
              Copy Monday to every day
            </button>
          )}
        </div>
        {form.hoursListed && (
          <>
            {DAYS.map(([key, label]) => {
              const day = form.hours[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-slate-600 shrink-0">{label}</span>
                  <select
                    value={day.mode}
                    onChange={(e) => setDay(key, { mode: e.target.value })}
                    aria-label={`${label} hours`}
                    className={inputClass}
                  >
                    <option value="open">Open</option>
                    <option value="24h">24 hours</option>
                    <option value="closed">Closed</option>
                  </select>
                  {day.mode === 'open' && (
                    <>
                      <input
                        type="time"
                        value={day.open}
                        onChange={(e) => setDay(key, { open: e.target.value })}
                        aria-label={`${label} opening time`}
                        className={inputClass}
                      />
                      <span className="text-sm text-slate-400">to</span>
                      <input
                        type="time"
                        value={day.close}
                        onChange={(e) => setDay(key, { close: e.target.value })}
                        aria-label={`${label} closing time`}
                        className={inputClass}
                      />
                      {day.close <= day.open && day.close !== day.open && (
                        <span className="text-xs text-slate-500">next day</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-slate-500">
              Times are in the branch's local time. A closing time earlier than the opening time runs past midnight.
            </p>
            {sameTimeDay && <p className="text-xs text-red-600">{sameTimeDay[1]}: opening and closing times can't be the same.</p>}
          </>
        )}
      </div>

      <div className="space-y-2 pt-3 border-t border-[var(--border)]">
        <h3 className="text-sm font-medium text-[var(--text-h)]">Map pin</h3>
        <p className="text-xs text-slate-500">
          In Google Maps, right-click the shop's entrance and click the coordinates to copy them, then paste them here.
        </p>
        <div className="flex items-center gap-3">
          <input
            inputMode="decimal"
            value={form.latitude}
            onChange={(e) => setField('latitude', e.target.value)}
            placeholder="Latitude, e.g. 11.5564"
            aria-label="Latitude"
            className={`flex-1 ${inputClass}`}
          />
          <input
            inputMode="decimal"
            value={form.longitude}
            onChange={(e) => setField('longitude', e.target.value)}
            placeholder="Longitude, e.g. 104.9282"
            aria-label="Longitude"
            className={`flex-1 ${inputClass}`}
          />
        </div>
        {coordError && <p className="text-xs text-red-600">{coordError}</p>}
        {!coordError && lat !== null && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-[var(--accent)]"
          >
            Check this pin on a map ↗
          </a>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {message && <p className="text-sm text-slate-600">{message}</p>}
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save branch details'}
        </button>
      </div>
    </div>
  );
}
