const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');

const router = express.Router();

// Fully local — no backend call. staff_pins is kept in sync by sync.js's
// pullCatalog() every 20s while paired; this is what lets a PIN unlock work
// even with no network at all, the same way checkout already does.
router.post('/api/auth/pin-unlock', async (req, res) => {
  const pin = String(req.body.pin ?? '');
  if (!pin) return res.status(400).json({ error: 'PIN is required' });

  const roster = query('SELECT * FROM staff_pins WHERE is_active = 1 AND pin_hash IS NOT NULL');

  for (const staff of roster) {
    if (await bcrypt.compare(pin, staff.pin_hash)) {
      return res.json({ userId: staff.user_id, name: staff.name, role: staff.role });
    }
  }

  res.status(401).json({ error: 'Invalid PIN' });
});

module.exports = router;
