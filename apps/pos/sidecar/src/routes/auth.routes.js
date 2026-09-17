const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { pinUnlockLimiter } = require('../rateLimiter');

const router = express.Router();

// One shared PIN pad per terminal — no per-caller identity to key by, unlike
// the backend's per-(terminalId:storeId) limiter — so this just tracks one
// lockout for the whole local endpoint.
const LIMITER_KEY = 'terminal';

// Fully local — no backend call. staff_pins is kept in sync by sync.js's
// pullCatalog() every 20s while paired; this is what lets a PIN unlock work
// even with no network at all, the same way checkout already does.
router.post('/api/auth/pin-unlock', async (req, res) => {
  const pin = String(req.body.pin ?? '');
  if (!pin) return res.status(400).json({ error: 'PIN is required' });

  const check = pinUnlockLimiter.checkAllowed(LIMITER_KEY);
  if (!check.allowed) {
    return res.status(429).json({ error: `Too many attempts. Try again in ${check.retryAfterSec}s.` });
  }

  const roster = query('SELECT * FROM staff_pins WHERE is_active = 1 AND pin_hash IS NOT NULL');

  for (const staff of roster) {
    if (await bcrypt.compare(pin, staff.pin_hash)) {
      pinUnlockLimiter.recordSuccess(LIMITER_KEY);
      return res.json({ userId: staff.user_id, name: staff.name, role: staff.role });
    }
  }

  pinUnlockLimiter.recordFailure(LIMITER_KEY);
  res.status(401).json({ error: 'Invalid PIN' });
});

module.exports = router;
