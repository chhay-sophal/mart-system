const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/api/summary/daily', (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) return res.status(400).json({ error: 'date_from and date_to required' });

  const base = [date_from, date_to];

  const rateRow = query("SELECT value FROM store_settings WHERE key = 'exchange_rate'")[0];
  const rate = parseFloat(rateRow?.value || '4100');

  const stats = query(
    `SELECT COUNT(*) as order_count, COALESCE(SUM(total_amount), 0) as total_revenue
     FROM orders WHERE created_at >= ? AND created_at < ? AND is_deleted = 0`,
    base
  )[0] || { order_count: 0, total_revenue: 0 };

  const byMethod = query(
    `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
     FROM orders WHERE created_at >= ? AND created_at < ? AND is_deleted = 0
     GROUP BY payment_method ORDER BY total DESC`,
    base
  );

  const topProducts = query(
    `SELECT p.name, SUM(oi.quantity) as total_qty,
            SUM(CASE WHEN oi.currency = 'KHR' THEN oi.price_at_sale / ${rate} ELSE oi.price_at_sale END * oi.quantity) as revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.created_at >= ? AND o.created_at < ? AND o.is_deleted = 0
     GROUP BY oi.product_id, p.name
     ORDER BY total_qty DESC LIMIT 5`,
    base
  );

  const profitRow = query(
    `SELECT COALESCE(SUM(
       (CASE WHEN oi.currency = 'KHR' THEN oi.price_at_sale / ${rate} ELSE oi.price_at_sale END
        - CASE WHEN p.currency = 'KHR' THEN p.cost_price / ${rate} ELSE p.cost_price END)
       * oi.quantity
     ), 0) as gross_profit
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.created_at >= ? AND o.created_at < ? AND o.is_deleted = 0`,
    base
  )[0] || { gross_profit: 0 };

  // Online orders handed over at this till (routes/onlineOrders.routes.js).
  // Kept separate from the till's own sales above: they were rung up on the
  // website, not here, but cash taken for them is in this drawer.
  const onlineByMethod = query(
    `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total_usd), 0) as total
     FROM online_order_collections WHERE collected_at >= ? AND collected_at < ?
     GROUP BY payment_method ORDER BY total DESC`,
    base
  );
  const onlineCount = onlineByMethod.reduce((n, m) => n + m.count, 0);
  const onlineTotal = onlineByMethod.reduce((n, m) => n + m.total, 0);

  res.json({
    online_collected: {
      count: onlineCount,
      total: onlineTotal,
      // Taken at this counter as cash — what to add when counting the drawer.
      cash_total: onlineByMethod.find((m) => m.payment_method === 'CASH')?.total ?? 0,
      by_method: onlineByMethod,
    },
    order_count: stats.order_count,
    total_revenue: stats.total_revenue,
    avg_order: stats.order_count > 0 ? stats.total_revenue / stats.order_count : 0,
    gross_profit: profitRow.gross_profit,
    by_method: byMethod,
    top_products: topProducts,
  });
});

module.exports = router;
