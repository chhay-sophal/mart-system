const express = require('express');
const { query } = require('../db');
const { parseRange, toLocalSql, fetchStoreReport } = require('../storeReports');

const router = express.Router();

// Paired and online: the whole store's day from the backend. Otherwise this
// register's local sales, with `offline` set when the store-wide view was
// expected but couldn't be fetched (see storeReports.js).
router.get('/api/summary/daily', async (req, res) => {
  const range = parseRange(req.query);
  if (!range.from || !range.to) return res.status(400).json({ error: 'date_from and date_to required' });

  const { config, data: remote } = await fetchStoreReport('/api/terminal/daily-summary', {
    date_from: range.from.toISOString(),
    date_to: range.to.toISOString(),
  });
  if (remote) return res.json({ ...remote, source: 'store', offline: false });

  const base = [toLocalSql(range.from), toLocalSql(range.to)];

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

  res.json({
    order_count: stats.order_count,
    total_revenue: stats.total_revenue,
    avg_order: stats.order_count > 0 ? stats.total_revenue / stats.order_count : 0,
    gross_profit: profitRow.gross_profit,
    by_method: byMethod,
    top_products: topProducts,
    source: 'local',
    offline: Boolean(config),
  });
});

module.exports = router;
