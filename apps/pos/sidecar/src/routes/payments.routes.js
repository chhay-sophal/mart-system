const express = require('express');
const { getSyncConfig } = require('../db');

const router = express.Router();

function authHeaders(config) {
  return { 'X-Terminal-Id': config.terminalId, 'X-Terminal-Secret': config.deviceSecret };
}

// KHQR is inherently online-only — generation/status-check happen on the
// central backend now (it owns the per-store Bakong merchant config), not
// locally. This proxy keeps the exact same request/response shape the
// frontend already calls, so no frontend changes are needed beyond this file
// existing: the frontend still talks to its local sidecar exactly as before.
router.post('/api/payments/khqr', async (req, res) => {
  const config = getSyncConfig();
  if (!config) {
    return res.status(503).json({ error: 'This terminal is not connected to a backend yet — configure Backend Sync in Settings to accept KHQR payments.' });
  }

  try {
    const response = await fetch(`${config.backendUrl}/api/payments/khqr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify({ amount: req.body.amount, currency: req.body.currency }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json({ qr_string: data.qrString, md5_hash: data.md5Hash, amount: data.amount, currency: data.currency });
  } catch (err) {
    res.status(502).json({ error: `Could not reach the backend: ${err.message}` });
  }
});

router.get('/api/payments/check-status/:md5_hash', async (req, res) => {
  const config = getSyncConfig();
  if (!config) {
    return res.status(503).json({ error: 'This terminal is not connected to a backend yet.' });
  }

  try {
    const response = await fetch(`${config.backendUrl}/api/payments/khqr/${req.params.md5_hash}/status`, {
      headers: authHeaders(config),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json({ status: data.status, md5_hash: req.params.md5_hash });
  } catch (err) {
    res.status(502).json({ error: `Could not reach the backend: ${err.message}` });
  }
});

module.exports = router;
