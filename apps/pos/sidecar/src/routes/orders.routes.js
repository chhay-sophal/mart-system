const express = require('express');
const { query, run, saveDb, localNow, begin, commit, rollback, generateUuid } = require('../db');

const router = express.Router();

const EXCHANGE_RATE = 4100;

// Fixed in Phase 2: the old app ran these inserts/updates sequentially with no
// BEGIN/COMMIT, so a mid-checkout failure could leave the in-memory db partially
// mutated. Wrapped in an explicit transaction now — this only fixes atomicity,
// it does NOT add a stock-availability check: negative stock is still allowed
// (confirmed decision — never block a sale over stock, reconcile later).
router.post('/api/orders/checkout', (req, res) => {
  const { customer_id, items, payment_method, bank_name, total_amount, amount_paid_usd, amount_paid_khr, khqr_data } = req.body;

  const totalPaidInUsd = parseFloat(amount_paid_usd || 0) + parseFloat(amount_paid_khr || 0) / EXCHANGE_RATE;
  const changeInUsd = totalPaidInUsd - parseFloat(total_amount);
  const changeGivenKhr = changeInUsd > 0 ? Math.round(changeInUsd * EXCHANGE_RATE) : 0;
  const clientOrderUuid = generateUuid();

  try {
    begin();

    const orderId = run(
      `INSERT INTO orders
        (customer_id, total_amount, currency, payment_method, bank_name, amount_paid_usd, amount_paid_khr, change_given_khr, status, client_order_uuid, created_at)
       VALUES (?, ?, 'USD', ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)`,
      [
        customer_id || null,
        total_amount,
        payment_method,
        bank_name || null,
        amount_paid_usd,
        amount_paid_khr,
        changeGivenKhr,
        clientOrderUuid,
        localNow(),
      ]
    );

    for (const item of items) {
      run(
        'INSERT INTO order_items (order_id, product_id, quantity, price_at_sale, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, item.id, item.quantity, item.price, item.currency || 'USD', localNow(), localNow()]
      );
      run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [item.quantity, localNow(), item.id]);
    }

    if (payment_method === 'KHQR' && khqr_data) {
      run(
        `INSERT INTO khqr_transactions (order_id, md5_hash, qr_string, bank_name, transaction_currency, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?)`,
        [orderId, khqr_data.md5_hash, khqr_data.qr_string, khqr_data.bank_name || 'Bakong Network', khqr_data.currency, total_amount, localNow(), localNow()]
      );
    }

    commit();
    saveDb();
    res.status(201).json({
      message: 'Transaction completed',
      order_id: orderId,
      client_order_uuid: clientOrderUuid,
      change_due_khr: changeGivenKhr,
    });
  } catch (err) {
    rollback();
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/orders', (req, res) => {
  const { date_from, date_to, payment_method } = req.query;
  const conditions = [];
  const params = [];

  conditions.push('is_deleted = 0');
  if (date_from) {
    conditions.push('created_at >= ?');
    params.push(date_from);
  }
  if (date_to) {
    conditions.push('created_at < ?');
    params.push(date_to);
  }
  if (payment_method && payment_method !== 'ALL') {
    conditions.push('payment_method = ?');
    params.push(payment_method);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const orders = query(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT 200`, params);

  const withItems = orders.map((order) => {
    const items = query(
      `SELECT p.name as product_name, oi.quantity, oi.price_at_sale as price, oi.currency
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [order.id]
    );
    return { ...order, items };
  });

  res.json(withItems);
});

router.delete('/api/orders/:id', (req, res) => {
  run('UPDATE orders SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?', [localNow(), localNow(), req.params.id]);
  saveDb();
  res.json({ message: 'Order voided' });
});

module.exports = router;
