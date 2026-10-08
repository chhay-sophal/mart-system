const express = require('express');
const { query, toLocalSql } = require('../db');
const { roundKhrToNote } = require('../money');
const { parseRange } = require('../storeReports');
const sync = require('../sync');

const router = express.Router();

// The whole store's day, computed from this register's locally synced copy
// of every terminal's orders (sync.js's background pull, same mirror Order
// History reads) -- no live backend call on the request path.
router.get('/api/summary/daily', (req, res) => {
  const range = parseRange(req.query);
  if (!range.from || !range.to) return res.status(400).json({ error: 'date_from and date_to required' });

  const base = [toLocalSql(range.from), toLocalSql(range.to)];

  const rateRow = query("SELECT value FROM store_settings WHERE key = 'exchange_rate'")[0];
  const rate = parseFloat(rateRow?.value || '4100');
  // Totals are stored in the store's main currency at the time. Revenue is
  // reported in USD, and in riel: exact for riel sales, converted (to the 100
  // note) for the rest -- the same as the backend's store-wide summary.
  const TOTAL_USD = `CASE WHEN currency = 'KHR' THEN total_amount / ${rate} ELSE total_amount END`;
  const TOTAL_KHR = `CASE WHEN currency = 'KHR' THEN total_amount ELSE ROUND(total_amount * ${rate} / 100) * 100 END`;

  const stats = query(
    `SELECT COUNT(*) as order_count, COALESCE(SUM(${TOTAL_USD}), 0) as total_revenue,
            COALESCE(SUM(${TOTAL_KHR}), 0) as total_revenue_khr
     FROM orders WHERE created_at >= ? AND created_at < ? AND is_deleted = 0`,
    base
  )[0] || { order_count: 0, total_revenue: 0, total_revenue_khr: 0 };

  const byMethod = query(
    `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(${TOTAL_USD}), 0) as total,
            COALESCE(SUM(${TOTAL_KHR}), 0) as total_khr
     FROM orders WHERE created_at >= ? AND created_at < ? AND is_deleted = 0
     GROUP BY payment_method ORDER BY total DESC`,
    base
  );

  // Per line-item revenue, in USD and in riel -- same exact-when-riel,
  // converted-and-rounded-to-the-note-otherwise rule TOTAL_USD/TOTAL_KHR use
  // above, just at item granularity. Backs per-product revenue below, so a
  // KHR-main-currency store's figures are backed by the same stored exchange
  // rate as everything else here, instead of the frontend having to
  // approximate them from today's live rate.
  const ITEM_REVENUE_USD = `CASE WHEN oi.currency = 'KHR' THEN (oi.price_at_sale * oi.quantity - oi.discount) / ${rate} ELSE oi.price_at_sale * oi.quantity - oi.discount END`;
  const ITEM_REVENUE_KHR = `CASE WHEN oi.currency = 'KHR' THEN oi.price_at_sale * oi.quantity - oi.discount ELSE ROUND((oi.price_at_sale * oi.quantity - oi.discount) * ${rate} / 100) * 100 END`;
  const ITEM_COST_USD = `CASE WHEN p.currency = 'KHR' THEN p.cost_price / ${rate} ELSE p.cost_price END`;
  // Profit's own riel figures -- exact when the line was priced in riel,
  // unrounded (no per-line note-rounding) otherwise. Profit isn't cash handed
  // to anyone like revenue above, so it rounds only once, on the final total
  // (see profitRow below: nearest cent in USD, nearest riel in KHR).
  const ITEM_REVENUE_KHR_EXACT = `CASE WHEN oi.currency = 'KHR' THEN oi.price_at_sale * oi.quantity - oi.discount ELSE (oi.price_at_sale * oi.quantity - oi.discount) * ${rate} END`;
  const ITEM_COST_KHR_EXACT = `CASE WHEN p.currency = 'KHR' THEN p.cost_price ELSE p.cost_price * ${rate} END`;

  // Unlimited, ordered by quantity sold -- top_products (below) is just this
  // sliced to 5 for the on-screen card; all_products (the full list) is for
  // the print report, which needs every product sold, not just the top ones.
  const allProducts = query(
    `SELECT p.name, SUM(oi.quantity) as total_qty,
            SUM(${ITEM_REVENUE_USD}) as revenue,
            SUM(${ITEM_REVENUE_KHR}) as revenue_khr
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.created_at >= ? AND o.created_at < ? AND o.is_deleted = 0
     GROUP BY oi.product_id, p.name
     ORDER BY total_qty DESC`,
    base
  );
  const topProducts = allProducts.slice(0, 5);

  const profitRow = query(
    `SELECT ROUND(COALESCE(SUM(${ITEM_REVENUE_USD} - ${ITEM_COST_USD} * oi.quantity), 0), 2) as gross_profit,
            ROUND(COALESCE(SUM(${ITEM_REVENUE_KHR_EXACT} - ${ITEM_COST_KHR_EXACT} * oi.quantity), 0)) as gross_profit_khr
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.created_at >= ? AND o.created_at < ? AND o.is_deleted = 0`,
    base
  )[0] || { gross_profit: 0, gross_profit_khr: 0 };

  res.json({
    order_count: stats.order_count,
    total_revenue: stats.total_revenue,
    total_revenue_khr: stats.total_revenue_khr,
    avg_order: stats.order_count > 0 ? stats.total_revenue / stats.order_count : 0,
    avg_order_khr: stats.order_count > 0 ? roundKhrToNote(stats.total_revenue_khr / stats.order_count) : 0,
    gross_profit: profitRow.gross_profit,
    gross_profit_khr: profitRow.gross_profit_khr,
    by_method: byMethod,
    top_products: topProducts,
    all_products: allProducts,
    offline: sync.getStatus().offline,
  });
});

module.exports = router;
