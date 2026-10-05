const express = require('express');
const { query, run, saveDb, localNow, begin, commit, rollback, generateUuid, enqueueOutboxEvent } = require('../db');
const { parseRange, toLocalSql, fetchStoreReport } = require('../storeReports');
const { roundUsd, roundAmount, roundKhrToNote } = require('../money');

const router = express.Router();

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
    return { id: item.id, quantity: item.quantity, currency, price: roundAmount(item.price, currency) };
  });

  const changeKhr = paidUsd * rate + paidKhr - (totalCurrency === 'KHR' ? total : total * rate);
  const changeGivenKhr = changeKhr > 0 ? roundKhrToNote(changeKhr) : 0;
  const clientOrderUuid = generateUuid();

  try {
    begin();

    const orderId = run(
      `INSERT INTO orders
        (customer_id, cashier_user_id, total_amount, currency, payment_method, bank_name, amount_paid_usd, amount_paid_khr, change_given_khr, status, client_order_uuid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)`,
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
        localNow(),
      ]
    );

    const backendItems = [];
    for (const item of lines) {
      run(
        'INSERT INTO order_items (order_id, product_id, quantity, price_at_sale, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, item.id, item.quantity, item.price, item.currency, localNow(), localNow()]
      );
      run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [item.quantity, localNow(), item.id]);

      const backendProductId = query('SELECT backend_product_id FROM products WHERE id = ?', [item.id])[0]?.backend_product_id;
      backendItems.push({ backendProductId, quantity: item.quantity, priceAtSale: item.price, currency: item.currency });
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

const LOCAL_ORDER_LIMIT = 200;

function receiptNoFor(localId) {
  return String(localId).padStart(4, '0');
}

/** This register's own orders in the range, newest first, in the shape the screen renders. */
function localOrders({ from, to }, limit = LOCAL_ORDER_LIMIT) {
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
  return orders.map((order) => ({
    ...order,
    total: order.total_amount,
    total_amount: order.currency === 'KHR' ? order.total_amount / rate : order.total_amount,
    receipt_no: receiptNoFor(order.id),
    can_delete: true,
    items: query(
      `SELECT p.name as product_name, oi.quantity, oi.price_at_sale as price, oi.currency
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      [order.id]
    ),
  }));
}

// Paired and online: the whole store's orders from the backend. This
// register's own sales keep their local number (and stay deletable, which
// voids them through sync); other terminals' and imported sales are view-only.
// Offline or unpaired: this register's local orders, with `offline` set when
// the store-wide view was expected but couldn't be fetched.
router.get('/api/orders', async (req, res) => {
  const range = parseRange(req.query);
  const { payment_method } = req.query;
  const byPayment = (o) => !payment_method || payment_method === 'ALL' || o.payment_method === payment_method;

  const { config, data: remote } = await fetchStoreReport('/api/terminal/orders', {
    date_from: range.from?.toISOString(),
    date_to: range.to?.toISOString(),
  });

  if (!Array.isArray(remote)) {
    return res.json({ source: 'local', offline: Boolean(config), orders: localOrders(range).filter(byPayment) });
  }

  const local = localOrders(range, 1000);
  const localByUuid = new Map(local.filter((o) => o.client_order_uuid).map((o) => [o.client_order_uuid, o]));
  // Voided sales (on any register, or in IMS) come back with status VOIDED:
  // hidden here, like this register's own voided sales are locally, but still
  // counted in remoteUuids below so a local copy isn't re-added as "unsynced".
  const merged = remote.filter((order) => order.status !== 'VOIDED').map((order) => {
    const own = localByUuid.get(order.client_order_uuid);
    return own
      ? { ...order, id: own.id, receipt_no: own.receipt_no, terminal_name: null, can_delete: true }
      : { ...order, can_delete: false };
  });

  // Own sales the backend doesn't have yet (still in the outbox). If the
  // backend's list was cut off by its limit, only add ones newer than the
  // oldest order it returned, so the list doesn't gain a stray older tail.
  const remoteUuids = new Set(remote.map((o) => o.client_order_uuid));
  const oldestRemote = remote.length >= 1000 ? new Date(remote[remote.length - 1].created_at) : null;
  for (const order of local) {
    if (remoteUuids.has(order.client_order_uuid)) continue;
    if (oldestRemote && new Date(order.created_at.replace(' ', 'T')) < oldestRemote) continue;
    merged.push(order);
  }
  merged.sort((a, b) => new Date(String(b.created_at).replace(' ', 'T')) - new Date(String(a.created_at).replace(' ', 'T')));

  res.json({ source: 'store', offline: false, orders: merged.filter(byPayment) });
});

router.delete('/api/orders/:id', (req, res) => {
  try {
    begin();
    const order = query('SELECT client_order_uuid FROM orders WHERE id = ?', [req.params.id])[0];
    run('UPDATE orders SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?', [localNow(), localNow(), req.params.id]);

    if (order?.client_order_uuid) {
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
