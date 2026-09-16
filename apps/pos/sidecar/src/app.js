const express = require('express');
const cors = require('cors');

const productsRoutes = require('./routes/products.routes');
const settingsRoutes = require('./routes/settings.routes');
const ordersRoutes = require('./routes/orders.routes');
const summaryRoutes = require('./routes/summary.routes');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use(productsRoutes);
  app.use(settingsRoutes);
  app.use(ordersRoutes);
  app.use(summaryRoutes);

  return app;
}

module.exports = { createApp };
