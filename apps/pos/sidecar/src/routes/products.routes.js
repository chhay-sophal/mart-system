const express = require('express');
const { query } = require('../db');

const router = express.Router();

// Read-only: the catalog itself is owned by IMS/backend and arrives here via
// sync.js's pullCatalog(). This terminal never creates/edits/deletes products
// or bulk-imports locally — see products.routes.js history if that's ever needed again.

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

// The whole branch catalog, for the register's Products tab (issue #13):
// read-only, searched on screen so results update as the cashier types.
router.get('/api/products', (req, res) => {
  res.json(
    query('SELECT id, name, barcode, price, cost_price as costPrice, currency, stock FROM products WHERE is_deleted = 0 ORDER BY name COLLATE NOCASE')
  );
});

router.get('/api/products/low-stock', (req, res) => {
  const threshold = parseInt(req.query.threshold) || 5;
  const items = query(
    'SELECT id, name, stock FROM products WHERE stock <= ? AND is_deleted = 0 ORDER BY stock ASC',
    [threshold]
  );
  res.json({ count: items.length, items });
});

module.exports = router;
