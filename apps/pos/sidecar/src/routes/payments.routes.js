const express = require('express');
const { getSyncConfig, getSyncSetting } = require('../db');

const router = express.Router();

function authHeaders(config) {
  return { 'X-Terminal-Id': config.terminalId, 'X-Terminal-Secret': config.deviceSecret };
}

// Never wait on the backend indefinitely: the register shows a clear error
// instead of hanging, and a status check never piles up behind a stuck one.
// Making a QR gets longer, since a sleeping backend can take a while to wake.
const GENERATE_TIMEOUT_MS = 20_000;
const STATUS_TIMEOUT_MS = 8_000;

function backendError(err) {
  return err.name === 'TimeoutError' ? 'The backend took too long to answer' : `Could not reach the backend: ${err.message}`;
}

// KHQR is inherently online-only — generation/status-check happen on the
// central backend now (it owns the per-store Bakong merchant config), not
// locally. This proxy keeps the exact same request/response shape the
// frontend already calls, so no frontend changes are needed beyond this file
// existing: the frontend still talks to its local sidecar exactly as before.
function merchantDetails() {
  const details = {
    bakongAccountId: getSyncSetting('bakong_account_id'),
    merchantName: getSyncSetting('bakong_merchant_name'),
    merchantCity: getSyncSetting('bakong_merchant_city'),
    storePhone: getSyncSetting('store_phone'),
  };
  // Blank ones are left out so the backend falls back to the store's values.
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value && value.trim()));
}

router.post('/api/payments/khqr', async (req, res) => {
  const config = getSyncConfig();
  if (!config) {
    return res.status(503).json({ error: 'This terminal is not connected to a backend yet — configure Backend Sync in Settings to accept KHQR payments.' });
  }

  try {
    const response = await fetch(`${config.backendUrl}/api/payments/khqr`, {
      method: 'POST',
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify({
        amount: req.body.amount,
        currency: req.body.currency,
        // This branch's merchant details, kept on the register (issue #5).
        // The backend uses them for this QR only and never stores them.
        ...merchantDetails(),
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json({
      qr_string: data.qrString,
      md5_hash: data.md5Hash,
      amount: data.amount,
      currency: data.currency,
      expires_at: data.expiresAt,
    });
  } catch (err) {
    res.status(502).json({ error: backendError(err) });
  }
});

router.get('/api/payments/check-status/:md5_hash', async (req, res) => {
  const config = getSyncConfig();
  if (!config) {
    return res.status(503).json({ error: 'This terminal is not connected to a backend yet.' });
  }

  try {
    // ?manual=1 (the cashier pressed Check payment) is passed on: the backend
    // then asks Bakong sooner than it would for an automatic check.
    const manual = req.query.manual === '1' ? '?manual=1' : '';
    const response = await fetch(`${config.backendUrl}/api/payments/khqr/${encodeURIComponent(req.params.md5_hash)}/status${manual}`, {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json({ status: data.status, md5_hash: req.params.md5_hash });
  } catch (err) {
    res.status(502).json({ error: backendError(err) });
  }
});

module.exports = router;
