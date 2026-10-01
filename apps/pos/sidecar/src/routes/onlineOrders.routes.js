const express = require('express');
const { getSyncConfig, run, saveDb, localNow } = require('../db');

const router = express.Router();

function authHeaders(config) {
  return { 'X-Terminal-Id': config.terminalId, 'X-Terminal-Secret': config.deviceSecret };
}

const ACTIONS = new Set(['ready', 'collect', 'cancel']);

// Online (storefront) orders live on the central backend, so — like KHQR —
// this screen only works while connected. These routes just forward to the
// backend's terminal endpoints with this till's device credential; offline,
// they answer 503 with `offline: true` so the screen can say so plainly.
async function forward(res, config, path, init = {}) {
  let response;
  try {
    response = await fetch(`${config.backendUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...authHeaders(config), ...(init.headers || {}) },
    });
  } catch (err) {
    res.status(503).json({ offline: true, error: `Could not reach the backend: ${err.message}` });
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    res.status(response.status).json(data);
    return null;
  }
  return data;
}

function requirePaired(res) {
  const config = getSyncConfig();
  if (!config) {
    res.status(503).json({ offline: true, error: 'This terminal is not connected to a backend yet — configure Backend Sync in Settings.' });
  }
  return config;
}

router.get('/api/online-orders', async (req, res) => {
  const config = requirePaired(res);
  if (!config) return;
  const status = typeof req.query.status === 'string' ? `?status=${encodeURIComponent(req.query.status)}` : '';
  const data = await forward(res, config, `/api/terminal/online-orders${status}`);
  if (data) res.json(data);
});

router.post('/api/online-orders/:orderId/:action', async (req, res) => {
  if (!ACTIONS.has(req.params.action)) return res.status(404).json({ error: 'Unknown action' });
  const config = requirePaired(res);
  if (!config) return;

  const body = { actorUserId: req.body.actorUserId, paymentMethod: req.body.paymentMethod };
  const order = await forward(res, config, `/api/terminal/online-orders/${encodeURIComponent(req.params.orderId)}/${req.params.action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!order) return;

  if (req.params.action === 'collect') {
    // KHQR orders were paid on the website, so no money changes hands here;
    // record them anyway (as KHQR) so the summary's online count is complete.
    run(
      `INSERT OR IGNORE INTO online_order_collections
         (backend_order_id, pickup_code, total_usd, payment_method, collected_by, collected_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [order.id, order.pickupCode, order.totalAmount, order.collectedPaymentMethod || 'KHQR_ONLINE', req.body.actorUserId || null, localNow()]
    );
    saveDb();
  }
  res.json(order);
});

module.exports = router;
