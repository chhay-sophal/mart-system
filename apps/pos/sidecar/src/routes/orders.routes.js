const express = require('express');
const { query, run, saveDb, localNow, toLocalSql, begin, commit, rollback, generateUuid, enqueueOutboxEvent, getSyncConfig } = require('../db');
const { parseRange } = require('../storeReports');
const { roundUsd, roundAmount, roundKhrToNote } = require('../money');
const sync = require('../sync');

const router = express.Router();

// The item discount on a cart line, as a total for the line in its own
// currency: a percentage of the line, or a fixed amount off each unit (never
// more than the unit price) -- the same rule the register screen uses.
function lineDiscount(item, price, currency) {
  const value = Number(item.discount) || 0;
  if (value <= 0) return 0;
  const qty = Number(item.quantity) || 0;
  const off = item.discountType === 'fixed' ? Math.min(value, price) * qty : (price * qty * Math.min(value, 100)) / 100;
  return roundAmount(off, currency);
}

function storeExchangeRate() {
  const rate = parseFloat(query("SELECT value FROM store_settings WHERE key = 'exchange_rate'")[0]?.value);
  return rate > 0 ? rate : 4100;
}

// Fixed in Phase 2: the old app ran these inserts/updates sequentially with no
// BEGIN/COMMIT, so a mid-checkout failure could leave the in-memory db partially
// mutated. Wrapped in an explicit transaction now — this only fixes atomicity,
// it does NOT add a stock-availability check: negative stock is still allowed
// (confirmed decision — never block a sale over stock, reconcile later).
router.post('/api/orders/checkout', (req, res) => {
  const { customer_id, items, payment_method, bank_name, total_amount, currency, amount_paid_usd, amount_paid_khr, khqr_data, cashier_user_id } = req.body;

  // The UI's own checkout button is already disabled for an empty cart, but
  // guard here too: an empty-items sale would still create an order locally,
  // then fail backend payload validation (items.min(1)) forever on every
  // sync retry with nothing to fix it — reject it before it's ever recorded.
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cannot check out an empty cart' });
  }

  // The total is stored in the currency the register charged in -- the
  // store's main currency -- at payment precision (money.js): USD to the cent,
  // riel to the note, exactly as the cashier saw it. Change is worked out from
  // the stored total so the two always agree.
  const rate = storeExchangeRate();
  const totalCurrency = currency === 'KHR' ? 'KHR' : 'USD';
  const total = totalCurrency === 'KHR' ? roundKhrToNote(total_amount) : roundUsd(total_amount);
  const totalUsd = totalCurrency === 'KHR' ? roundUsd(total / rate) : total;
  const paidUsd = roundUsd(amount_paid_usd);
  const paidKhr = roundAmount(amount_paid_khr, 'KHR');
  const lines = items.map((item) => {
    const currency = item.currency || 'USD';
    const price = roundAmount(item.price, currency);
    return { id: item.id, quantity: item.quantity, currency, price, discount: lineDiscount(item, price, currency) };
  });

  const changeKhr = paidUsd * rate + paidKhr - (totalCurrency === 'KHR' ? total : total * rate);
  const changeGivenKhr = changeKhr > 0 ? roundKhrToNote(changeKhr) : 0;
  const clientOrderUuid = generateUuid();

  try {
    begin();

    const orderId = run(
      `INSERT INTO orders
        (customer_id, cashier_user_id, total_amount, currency, payment_method, bank_name, amount_paid_usd, amount_paid_khr, change_given_khr, status, client_order_uuid, terminal_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
      [
        customer_id || null,
        cashier_user_id || null,
        total,
        totalCurrency,
        payment_method,
        bank_name || null,
        paidUsd,
        paidKhr,
        changeGivenKhr,
        clientOrderUuid,
        getSyncConfig()?.terminalId ?? null,
        localNow(),
      ]
    );

    const backendItems = [];
    for (const item of lines) {
      run(
        'INSERT INTO order_items (order_id, product_id, quantity, price_at_sale, discount, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [orderId, item.id, item.quantity, item.price, item.discount, item.currency, localNow(), localNow()]
      );
      run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [item.quantity, localNow(), item.id]);

      const backendProductId = query('SELECT backend_product_id FROM products WHERE id = ?', [item.id])[0]?.backend_product_id;
      backendItems.push({ backendProductId, quantity: item.quantity, priceAtSale: item.price, discount: item.discount, currency: item.currency });
    }

    // Only enqueue a sync event if every item resolves to a backend product —
    // a local-only product (pre-dating pairing) means this specific sale just
    // never syncs; the sale itself still completed locally either way.
    if (backendItems.every((i) => i.backendProductId)) {
      enqueueOutboxEvent('SALE_COMPLETED', {
        clientOrderUuid,
        items: backendItems.map((i) => ({
          productId: i.backendProductId,
          quantity: i.quantity,
          priceAtSale: i.priceAtSale,
          discount: i.discount,
          currency: i.currency,
        })),
        paymentMethod: payment_method,
        totalAmount: total,
        currency: totalCurrency,
        amountPaidUsd: paidUsd,
        amountPaidKhr: paidKhr,
        changeGivenKhr,
        ...(cashier_user_id ? { cashierUserId: cashier_user_id } : {}),
        ...(bank_name ? { bankName: bank_name } : {}),
        ...(khqr_data?.md5_hash
          ? {
              khqrMd5Hash: khqr_data.md5_hash,
              khqrQrString: khqr_data.qr_string,
              ...(khqr_data.bank_name ? { khqrBankName: khqr_data.bank_name } : {}),
            }
          : {}),
      });
    }

    if (payment_method === 'KHQR' && khqr_data) {
      run(
        `INSERT INTO khqr_transactions (order_id, md5_hash, qr_string, bank_name, transaction_currency, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', ?, ?)`,
        [orderId, khqr_data.md5_hash, khqr_data.qr_string, khqr_data.bank_name || 'Bakong Network', khqr_data.currency, khqr_data.currency === totalCurrency ? total : totalUsd, localNow(), localNow()]
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

const LOCAL_ORDER_LIMIT = 1000;

function receiptNoFor(localId) {
  return String(localId).padStart(4, '0');
}

/**
 * The backend's own receipt-number style (orders.service.ts's receiptNo()),
 * for a pulled order this register didn't ring up itself -- it reads the
 * same number here as it does in IMS or on the register that made the sale.
 */
function remoteReceiptNo(clientOrderUuid) {
  if (clientOrderUuid.startsWith('online-pos:')) {
    return `OP-${clientOrderUuid.split(':').pop().padStart(4, '0')}`;
  }
  return clientOrderUuid.replace(/-/g, '').slice(0, 6).toUpperCase();
}

/**
 * The whole store's orders in the range, newest first, in the shape the
 * screen renders. sync.js's background pull keeps this register's copy of
 * every terminal's sales up to date (same as the product catalog already
 * was), so this is a plain local read -- no live backend call on the request
 * path. A sale this register rang up itself keeps its local receipt number
 * and stays deletable (voiding it queues a sync event); one pulled in from
 * another register or IMS is view-only.
 */
function localOrders({ from, to }, limit = LOCAL_ORDER_LIMIT) {
  const config = getSyncConfig();
  const conditions = ['is_deleted = 0'];
  const params = [];
  if (from) {
    conditions.push('created_at >= ?');
    params.push(toLocalSql(from));
  }
  if (to) {
    conditions.push('created_at < ?');
    params.push(toLocalSql(to));
  }
  const orders = query(`SELECT * FROM orders WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, [
    ...params,
    limit,
  ]);
  const rate = storeExchangeRate();
  // Same shape as the backend's orders: total + currency as stored,
  // total_amount in USD for sums and sorting.
  return orders.map((order) => {
    // NULL terminal_id predates this column and is always this register's
    // own sale (db.js backfills every pre-existing row to match) -- otherwise
    // compare to who we are now. Unpaired, every local order is this
    // register's own by definition.
    const isOwn = order.terminal_id == null || !config || order.terminal_id === config.terminalId;
    return {
      ...order,
      total: order.total_amount,
      total_amount: order.currency === 'KHR' ? order.total_amount / rate : order.total_amount,
      receipt_no: isOwn ? receiptNoFor(order.id) : remoteReceiptNo(order.client_order_uuid),
      terminal_name: isOwn ? null : order.terminal_name,
      can_delete: isOwn,
      items: query(
        `SELECT p.name as product_name, oi.quantity, oi.price_at_sale as price, oi.discount, oi.currency
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?`,
        [order.id]
      ),
    };
  });
}

router.get('/api/orders', (req, res) => {
  const range = parseRange(req.query);
  const { payment_method } = req.query;
  const byPayment = (o) => !payment_method || payment_method === 'ALL' || o.payment_method === payment_method;
  res.json({ offline: sync.getStatus().offline, orders: localOrders(range).filter(byPayment) });
});

router.delete('/api/orders/:id', (req, res) => {
  try {
    const order = query('SELECT client_order_uuid, terminal_id FROM orders WHERE id = ?', [req.params.id])[0];
    // Now that a pulled order (another register's sale) has a real local row
    // and id (Phase 2), it needs its own guard here -- the UI already hides
    // the void button for one (can_delete), but a locally-mutated row
    // wouldn't be corrected by the next pull since this register still
    // thinks it's the one with the "latest" local state for it.
    const config = getSyncConfig();
    if (!order || (order.terminal_id != null && config && order.terminal_id !== config.terminalId)) {
      return res.status(404).json({ error: 'Order not found' });
    }

    begin();
    run('UPDATE orders SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?', [localNow(), localNow(), req.params.id]);

    if (order.client_order_uuid) {
      enqueueOutboxEvent('SALE_VOIDED', { clientOrderUuid: order.client_order_uuid });
    }

    commit();
    saveDb();
    res.json({ message: 'Order voided' });
  } catch (err) {
    rollback();
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
