const express = require('express');
const { query, getSyncConfig } = require('../db');

const router = express.Router();

// Answers "is this terminal's sync healthy right now" from data the outbox
// already tracks — no new local table. The push/pull loop itself only logs
// failures to the (invisible, background-process) console; this is the
// surface an actual store owner/cashier can see, on the terminal's own screen.
router.get('/api/sync/status', (req, res) => {
  const pendingCount = query("SELECT COUNT(*) as n FROM outbox_events WHERE status = 'PENDING'")[0]?.n ?? 0;
  const failedCount = query("SELECT COUNT(*) as n FROM outbox_events WHERE status = 'FAILED'")[0]?.n ?? 0;
  // DEAD = gave up after MAX_RETRIES_BEFORE_DEAD explicit rejections (sync.js)
  // — distinct from FAILED (still retrying) so staff know these sales need a
  // manual look, not just "wait for the network."
  const deadCount = query("SELECT COUNT(*) as n FROM outbox_events WHERE status = 'DEAD'")[0]?.n ?? 0;
  const lastFailure = query(
    "SELECT last_error, created_at FROM outbox_events WHERE status IN ('FAILED', 'DEAD') ORDER BY id DESC LIMIT 1"
  )[0];

  res.json({
    isPaired: Boolean(getSyncConfig()),
    pendingCount,
    failedCount,
    deadCount,
    lastError: lastFailure?.last_error ?? null,
    lastErrorAt: lastFailure?.created_at ?? null,
  });
});

module.exports = router;
