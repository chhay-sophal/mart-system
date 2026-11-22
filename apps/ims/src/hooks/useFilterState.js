import { usePersistentState } from './usePersistentState';
import { presetRange } from '../lib/dateRange';
import { useAuth } from '../auth/AuthContext.jsx';

// Page filters remembered across visits (storage: lib/filterState.js).

/**
 * A remembered store choice ('' = all stores). A saved store the user can no
 * longer access falls back to `initial`.
 */
export function useStoreFilterState(key, initial) {
  const { stores } = useAuth();
  const [storeId, setStoreId] = usePersistentState(key, initial);
  const valid = storeId === '' || stores.some((s) => s.id === storeId);
  return [valid ? storeId : initial, setStoreId];
}

/**
 * A remembered date range: [dateFrom, dateTo, setRange(from, to)]. A range
 * matching one of `presets` is remembered as that preset, so "Today" still
 * means today when you come back tomorrow; a custom range is remembered as
 * its dates.
 */
export function useDateRangeState(key, presets, defaultPreset = 'today') {
  const [saved, setSaved] = usePersistentState(key, { preset: defaultPreset });
  const preset = saved?.preset && presets.includes(saved.preset) ? saved.preset : null;
  const { from, to } = preset
    ? presetRange(preset)
    : saved && typeof saved.from === 'string' && typeof saved.to === 'string'
      ? saved
      : presetRange(defaultPreset);

  const setRange = (nextFrom, nextTo) => {
    const match = presets.find((p) => {
      const r = presetRange(p);
      return r.from === nextFrom && r.to === nextTo;
    });
    setSaved(match ? { preset: match } : { from: nextFrom, to: nextTo });
  };
  return [from, to, setRange];
}
