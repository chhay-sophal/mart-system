const express = require('express');
const { query, toLocalSql } = require('../db');
const { roundKhrToNote } = require('../money');
const { parseRange } = require('../storeReports');
const sync = require('../sync');

const router = express.Router();

// The whole store's day, computed from this register's locally synced copy
// of every terminal's orders (sync.js's background pull, same mirror Order
// History reads) -- no live backend call on the request path. Same rules as
// the backend's computeStoreDailySummary (reports.service.ts); keep the two
// in step.
router.get('/api/summary/daily', (req, res) => {
  const range = parseRange(req.query);
  if (!range.from || !range.to) return res.status(400).json({ error: 'date_from and date_to required' });

  const base = [toLocalSql(range.from), toLocalSql(range.to)];

  // Today's rate: the fallback for sales from before each order kept its own.
  const rateRow = query("SELECT value FROM store_settings WHERE key = 'exchange_rate'")[0];
  const currentRate = parseFloat(rateRow?.value || '4100');

  // A void sets is_deleted (locally, or via sync.js for a void elsewhere).
  const orders = query(
    `SELECT id, total_amount, currency, payment_method, exchange_rate
     FROM orders WHERE created_at >= ? AND created_at < ? AND is_deleted = 0`,
    base
  );
  const items = query(
    `SELECT oi.order_id, oi.product_id, oi.quantity, oi.price_at_sale, oi.discount, oi.currency,
            oi.cost_at_sale, oi.cost_currency,
            p.name, p.cost_price, COALESCE(p.cost_currency, p.currency) AS product_cost_currency
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.created_at >= ? AND o.created_at < ? AND o.is_deleted = 0`,
    base
  );
  const itemsByOrder = new Map();
  for (const item of items) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  }

  // Each sale converts at the rate it was rung up at. Totals are stored in
  // the store's main currency at the time. Revenue is reported in USD, and in
  // riel: exact for riel sales, converted (to the 100 note) for the rest.
  const rateOf = (order) => (order.exchange_rate > 0 ? order.exchange_rate : currentRate);
  const toUsd = (amount, currency, rate) => (currency === 'KHR' ? amount / rate : amount);
  const orderTotalUsd = (order) => toUsd(order.total_amount, order.currency, rateOf(order));
  const orderTotalKhr = (order) =>
    order.currency === 'KHR' ? order.total_amount : roundKhrToNote(orderTotalUsd(order) * rateOf(order));

  let totalRevenue = 0;
  let totalRevenueKhr = 0;
  const byMethodMap = new Map();
  for (const order of orders) {
    totalRevenue += orderTotalUsd(order);
    totalRevenueKhr += orderTotalKhr(order);
    const entry = byMethodMap.get(order.payment_method) ?? { payment_method: order.payment_method, count: 0, total: 0, total_khr: 0 };
    entry.count += 1;
    entry.total += orderTotalUsd(order);
    entry.total_khr += orderTotalKhr(order);
    byMethodMap.set(order.payment_method, entry);
  }
  const byMethod = [...byMethodMap.values()].sort((a, b) => b.total - a.total);

  const productAgg = new Map();
  let grossProfit = 0;
  let grossProfitKhr = 0;
  // Sold lines with no known cost: left out of gross profit entirely (rather
  // than counted as all profit), and reported so the screen can say so.
  let uncostedRevenue = 0;
  let uncostedRevenueKhr = 0;

  for (const order of orders) {
    const rate = rateOf(order);
    const lines = (itemsByOrder.get(order.id) ?? []).map((item) => {
      // What the line charged before any sale-wide discount.
      const charged = item.price_at_sale * item.quantity - (item.discount || 0);
      const revenueUsd = toUsd(charged, item.currency, rate);
      // Exact when the line was priced in riel; otherwise the raw (unrounded)
      // converted figure.
      const revenueKhrExact = item.currency === 'KHR' ? charged : revenueUsd * rate;
      return { item, revenueUsd, revenueKhrExact };
    });

    // A sale-wide discount is only in the order's total, never on its lines:
    // spread it over the lines in proportion to what each charged, so the
    // lines add up to what the customer actually paid.
    const linesUsd = lines.reduce((sum, line) => sum + line.revenueUsd, 0);
    const linesKhr = lines.reduce((sum, line) => sum + line.revenueKhrExact, 0);
    const totalKhrExact = order.currency === 'KHR' ? order.total_amount : orderTotalUsd(order) * rate;
    const shareUsd = linesUsd > 0 ? orderTotalUsd(order) / linesUsd : 1;
    const shareKhr = linesKhr > 0 ? totalKhrExact / linesKhr : 1;

    for (const { item, revenueUsd, revenueKhrExact } of lines) {
      const lineRevenue = revenueUsd * shareUsd;
      const lineRevenueKhrExact = revenueKhrExact * shareKhr;
      // Revenue (shown as cash) rounds to the note per line, unless it's an
      // untouched riel price; profit rounds only once, on the final totals.
      const lineRevenueKhr =
        item.currency === 'KHR' && shareKhr === 1 ? lineRevenueKhrExact : roundKhrToNote(lineRevenueKhrExact);

      const key = item.product_id ?? `unknown:${item.name ?? ''}`;
      const agg = productAgg.get(key) ?? {
        name: item.name ?? '?',
        total_qty: 0,
        revenue: 0,
        revenue_khr: 0,
        profit: 0,
        profit_khr: 0,
        uncosted_qty: 0,
      };
      agg.total_qty += item.quantity;
      agg.revenue += lineRevenue;
      agg.revenue_khr += lineRevenueKhr;
      productAgg.set(key, agg);

      // The cost kept on the line when it sold; lines from before that fall
      // back to the product's current cost. A cost of 0 means "never set".
      const cost =
        item.cost_at_sale != null && item.cost_currency
          ? { amount: item.cost_at_sale, currency: item.cost_currency }
          : item.cost_price > 0
            ? { amount: item.cost_price, currency: item.product_cost_currency }
            : null;
      if (!cost) {
        agg.uncosted_qty += item.quantity;
        uncostedRevenue += lineRevenue;
        uncostedRevenueKhr += lineRevenueKhr;
        continue;
      }
      const costUsd = toUsd(cost.amount, cost.currency, rate);
      const costKhrExact = cost.currency === 'KHR' ? cost.amount : costUsd * rate;
      const lineProfit = lineRevenue - costUsd * item.quantity;
      const lineProfitKhr = lineRevenueKhrExact - costKhrExact * item.quantity;
      agg.profit += lineProfit;
      agg.profit_khr += lineProfitKhr;
      grossProfit += lineProfit;
      grossProfitKhr += lineProfitKhr;
    }
  }

  // Unlimited, ordered by quantity sold -- top_products (below) is just this
  // sliced to 5 for the on-screen card; all_products (the full list) is for
  // the print report, which needs every product sold, not just the top ones.
  // Profit: nearest cent in USD, nearest riel in KHR; null when none of a
  // product's units had a cost.
  const allProducts = [...productAgg.values()]
    .map(({ uncosted_qty, ...p }) => {
      const noCost = uncosted_qty === p.total_qty;
      return {
        ...p,
        profit: noCost ? null : Math.round(p.profit * 100) / 100,
        profit_khr: noCost ? null : Math.round(p.profit_khr),
        uncosted_qty,
      };
    })
    .sort((a, b) => b.total_qty - a.total_qty);
  const topProducts = allProducts.slice(0, 5);

  const orderCount = orders.length;
  res.json({
    order_count: orderCount,
    total_revenue: totalRevenue,
    total_revenue_khr: totalRevenueKhr,
    avg_order: orderCount > 0 ? totalRevenue / orderCount : 0,
    avg_order_khr: orderCount > 0 ? roundKhrToNote(totalRevenueKhr / orderCount) : 0,
    gross_profit: Math.round(grossProfit * 100) / 100,
    gross_profit_khr: Math.round(grossProfitKhr),
    uncosted_revenue: uncostedRevenue,
    uncosted_revenue_khr: uncostedRevenueKhr,
    uncosted_product_count: allProducts.filter((p) => p.uncosted_qty > 0).length,
    by_method: byMethod,
    top_products: topProducts,
    all_products: allProducts,
    offline: sync.getStatus().offline,
  });
});

module.exports = router;
