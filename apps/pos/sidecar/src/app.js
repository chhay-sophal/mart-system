const express = require('express');
const cors = require('cors');

const productsRoutes = require('./routes/products.routes');
const settingsRoutes = require('./routes/settings.routes');
const ordersRoutes = require('./routes/orders.routes');
const summaryRoutes = require('./routes/summary.routes');
const paymentsRoutes = require('./routes/payments.routes');
const backupRoutes = require('./routes/backup.routes');
const syncStatusRoutes = require('./routes/sync.routes');
const authRoutes = require('./routes/auth.routes');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use(productsRoutes);
  app.use(settingsRoutes);
  app.use(ordersRoutes);
  app.use(summaryRoutes);
  app.use(paymentsRoutes);
  app.use(backupRoutes);
  app.use(syncStatusRoutes);
  app.use(authRoutes);

  return app;
}

module.exports = { createApp };
