// Cashier-facing "tap to tender" amounts (Settings > General > Tendered
// Amount Presets): admin-customized per currency, stored as a JSON array
// string under one settings key each -- same pattern as staticQr.js's bank
// QR list. The order's exact total isn't stored here; it's computed fresh at
// checkout (see TenderPresetChips).

export const TENDER_PRESETS_ENABLED_KEY = 'tender_presets_enabled';
export const TENDER_PRESETS_USD_KEY = 'tender_presets_usd';
export const TENDER_PRESETS_KHR_KEY = 'tender_presets_khr';
// Whether checkout shows a tender field for the store's non-main currency too
// (e.g. a KHR-main store still taking USD cash), under the main one. On
// unless turned off -- matches the checkout's existing two-field behavior.
export const TENDER_SECONDARY_ENABLED_KEY = 'tender_secondary_currency_enabled';

export const DEFAULT_USD_PRESETS = [0.01, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
export const DEFAULT_KHR_PRESETS = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

/** One currency's preset list out of its settings JSON string, falling back to `fallback` on anything malformed or empty. */
export function parseTenderPresets(json, fallback) {
  try {
    const list = JSON.parse(json);
    if (!Array.isArray(list)) return fallback;
    const amounts = list.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    return amounts.length > 0 ? amounts : fallback;
  } catch {
    return fallback;
  }
}

export const serializeTenderPresets = (amounts) => JSON.stringify(amounts);
