const express = require('express');
const { query, run, saveDb, localNow } = require('../db');

const router = express.Router();

// Draft carts (issue #1): a sale set aside mid-checkout -- the customer went
// to fetch more items -- so the cashier can serve the next person in line and
// pick it up again later without rescanning. Local to this register; nothing
// is sold or synced until the draft is resumed and checked out. Stock isn't
// held for a draft.

const toDraft = (row) => {
  let saved = {};
  try {
    saved = JSON.parse(row.payload);
  } catch {
    // An unreadable draft still lists (empty) so it can be deleted.
  }
  return {
    id: row.id,
    created_at: row.created_at,
    cart: Array.isArray(saved.cart) ? saved.cart : [],
    txDiscountType: saved.txDiscountType === 'fixed' ? 'fixed' : 'pct',
    txDiscountValue: saved.txDiscountValue ?? '',
  };
};

router.get('/api/drafts', (req, res) => {
  res.json(query('SELECT * FROM draft_carts ORDER BY created_at ASC, id ASC').map(toDraft));
});

router.post('/api/drafts', (req, res) => {
  const { cart, txDiscountType, txDiscountValue } = req.body || {};
  if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'Nothing in the cart to save' });
  const id = run('INSERT INTO draft_carts (payload, created_at) VALUES (?, ?)', [
    JSON.stringify({ cart, txDiscountType, txDiscountValue }),
    localNow(),
  ]);
  saveDb();
  res.status(201).json({ id });
});

router.delete('/api/drafts/:id', (req, res) => {
  run('DELETE FROM draft_carts WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ message: 'Draft deleted' });
});

module.exports = router;
