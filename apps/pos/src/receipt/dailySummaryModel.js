// What the daily summary report says, independent of how it's printed --
// mirrors receiptModel.js's buildReceipt, so raster.js can lay it out as an
// image for both the direct ESC/POS path and the system print dialog.

/**
 * @param {object} summary - the /api/summary/daily response
 * @param {object} shop - { storeName, storeAddress }
 * @param {string} title
 * @param {string} dateLabel - already-formatted date string
 * @param {(n: number, khr?: number) => string} fmt
 * @param {(method: string) => string} methodLabel
 * @param {object} s - the dailySummary locale strings
 * @param {boolean} [includeProducts] - false skips the Products Sold section entirely (just the summary/payment breakdown)
 */
export function buildDailySummary({ summary, shop, title, dateLabel, fmt, methodLabel, s, includeProducts = true }) {
  const blocks = [];
  const add = (block) => blocks.push(block);

  if (shop.storeName) add({ type: 'text', text: shop.storeName, align: 'center', size: 'lg', bold: true });
  if (shop.storeAddress) add({ type: 'text', text: shop.storeAddress, align: 'center', size: 'sm' });
  add({ type: 'text', text: title, align: 'center', size: 'md' });
  add({ type: 'text', text: dateLabel, align: 'center', size: 'sm' });
  add({ type: 'rule' });

  add({ type: 'pair', left: s.revenue || 'Revenue', right: fmt(summary.total_revenue, summary.total_revenue_khr), bold: true });
  add({ type: 'pair', left: s.orders || 'Orders', right: String(summary.order_count) });
  add({ type: 'pair', left: s.avg || 'Avg', right: fmt(summary.avg_order, summary.avg_order_khr) });
  add({ type: 'pair', left: s.grossProfit || 'Gross Profit', right: fmt(summary.gross_profit, summary.gross_profit_khr), bold: true });
  add({
    type: 'pair',
    left: s.margin || 'Margin',
    right: summary.total_revenue > 0 ? `${((summary.gross_profit / summary.total_revenue) * 100).toFixed(1)}%` : '—',
  });

  if (summary.by_method?.length > 0) {
    add({ type: 'rule' });
    add({ type: 'text', text: s.paymentBreakdown || 'Payment Breakdown', bold: true });
    summary.by_method.forEach((m) => {
      add({ type: 'pair', left: `${methodLabel(m.payment_method)} (${m.count})`, right: fmt(m.total, m.total_khr) });
    });
  }

  if (includeProducts) {
    add({ type: 'rule' });
    add({ type: 'text', text: s.productsSold || 'Products Sold', bold: true });
    (summary.all_products ?? summary.top_products ?? []).forEach((p, i) => {
      add({
        type: 'item',
        no: `${i + 1}.`,
        name: p.name,
        detail: `${p.total_qty} ${s.colQty || 'Qty'}`,
        amount: fmt(p.revenue, p.revenue_khr),
        note: `${s.colProfit || 'Profit'}: ${fmt(p.profit, p.profit_khr)}`,
      });
    });
  }

  add({ type: 'rule' });
  add({ type: 'text', text: new Date().toLocaleString(), align: 'center', size: 'sm' });
  return blocks;
}
