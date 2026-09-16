const express = require('express');
const { query, run, saveDb, localNow } = require('../db');

const router = express.Router();

router.get('/api/products/barcode/:barcode', (req, res) => {
  const barcodeParam = req.params.barcode.toLowerCase();
  if (!barcodeParam) return res.status(400).json({ message: 'Barcode is required' });

  const rows = query(
    'SELECT id, name, barcode, price, currency, stock FROM products WHERE LOWER(barcode) = ? AND is_deleted = 0',
    [barcodeParam]
  );

  if (!rows.length) return res.status(404).json({ message: 'Barcode not registered in system' });
  res.json(rows[0]);
});

router.get('/api/products', (req, res) => {
  res.json(query('SELECT * FROM products WHERE is_deleted = 0 ORDER BY name ASC'));
});

router.get('/api/products/low-stock', (req, res) => {
  const threshold = parseInt(req.query.threshold) || 5;
  const items = query(
    'SELECT id, name, stock FROM products WHERE stock <= ? AND is_deleted = 0 ORDER BY stock ASC',
    [threshold]
  );
  res.json({ count: items.length, items });
});

router.delete('/api/products/:id', (req, res) => {
  run('UPDATE products SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?', [localNow(), localNow(), req.params.id]);
  saveDb();
  res.json({ message: 'Product removed' });
});

router.post('/api/products', (req, res) => {
  const { name, barcode, price, cost_price, currency, stock } = req.body;
  try {
    const id = run(
      'INSERT INTO products (name, barcode, price, cost_price, currency, stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, barcode, parseFloat(price), parseFloat(cost_price || 0), currency || 'USD', parseInt(stock) || 0, localNow(), localNow()]
    );
    saveDb();
    res.status(201).json(query('SELECT * FROM products WHERE id = ?', [id])[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/products/bulk', (req, res) => {
  const { products: rows, updateExisting } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No products provided' });
  }

  let imported = 0,
    updated = 0,
    skipped = 0,
    errorCount = 0;

  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    const price = parseFloat(row.price);
    const barcode = String(row.barcode ?? '').trim() || null;
    const cost_price = parseFloat(row.cost_price) || 0;
    const currency = ['USD', 'KHR'].includes(String(row.currency ?? '').toUpperCase())
      ? String(row.currency).toUpperCase()
      : 'USD';
    const stock = parseInt(row.stock) || 0;

    if (!name || isNaN(price) || price < 0) {
      skipped++;
      continue;
    }

    try {
      if (barcode && updateExisting) {
        const existing = query('SELECT id FROM products WHERE barcode = ? AND is_deleted = 0', [barcode]);
        if (existing.length) {
          run(
            'UPDATE products SET name = ?, price = ?, cost_price = ?, currency = ?, stock = ?, updated_at = ? WHERE id = ?',
            [name, price, cost_price, currency, stock, localNow(), existing[0].id]
          );
          updated++;
          continue;
        }
      }
      run(
        'INSERT INTO products (name, barcode, price, cost_price, currency, stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, barcode, price, cost_price, currency, stock, localNow(), localNow()]
      );
      imported++;
    } catch (err) {
      errorCount++;
    }
  }

  saveDb();
  res.json({ imported, updated, skipped, errors: errorCount });
});

router.put('/api/products/:id', (req, res) => {
  const { name, barcode, price, cost_price, currency, stock } = req.body;
  run(
    'UPDATE products SET name = ?, barcode = ?, price = ?, cost_price = ?, currency = ?, stock = ?, updated_at = ? WHERE id = ?',
    [name, barcode, parseFloat(price), parseFloat(cost_price || 0), currency || 'USD', parseInt(stock), localNow(), req.params.id]
  );
  saveDb();
  const updated = query('SELECT * FROM products WHERE id = ?', [req.params.id])[0];
  if (!updated) return res.status(404).json({ error: 'Product not found' });
  res.json(updated);
});

module.exports = router;
