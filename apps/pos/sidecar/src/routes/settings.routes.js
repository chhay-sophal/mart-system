const express = require('express');
const { query, run, saveDb, normalizeBackendUrl, getSyncSetting, resetSyncStateForNewPairing } = require('../db');

const router = express.Router();

// The Bakong API token (Phase 4+) is cached in store_settings purely as an
// internal cache and must never be readable/writable through the settings API.
const INTERNAL_ONLY_SETTINGS = ['bakong_api_token'];

router.get('/api/settings', (req, res) => {
  const rows = query('SELECT key, value FROM store_settings');
  const obj = {};
  rows.forEach((r) => {
    if (!INTERNAL_ONLY_SETTINGS.includes(r.key)) obj[r.key] = r.value;
  });
  res.json(obj);
});

router.put('/api/settings', (req, res) => {
  const pairingKeys = ['sync_backend_url', 'sync_terminal_id'];
  const pairingBefore = pairingKeys.map((key) => getSyncSetting(key) ?? '');

  for (let [key, value] of Object.entries(req.body)) {
    if (INTERNAL_ONLY_SETTINGS.includes(key)) continue;
    if (key === 'sync_backend_url') value = normalizeBackendUrl(value);
    run('INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      String(value),
    ]);
  }

  // Re-paired (different backend or terminal): start sync from scratch. The
  // first-time pairing changes these too, which is harmless -- nothing to reset.
  const pairingAfter = pairingKeys.map((key) => getSyncSetting(key) ?? '');
  if (pairingAfter.some((value, i) => value !== pairingBefore[i])) resetSyncStateForNewPairing();
  saveDb();
  res.json({ message: 'Settings saved' });
});

module.exports = router;
