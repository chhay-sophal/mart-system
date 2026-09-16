require('dotenv').config();

const db = require('./src/db');
const { createApp } = require('./src/app');
const sync = require('./src/sync');

const PORT = process.env.PORT ? Number(process.env.PORT) : 0;

async function start() {
  await db.init();

  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1', () => {
    const actualPort = server.address().port;
    console.log(`PORT:${actualPort}`);
    console.log(`Mart System POS sidecar running on port ${actualPort}`);
    console.log(`Data: ${db.DB_PATH}`);
    // No-op until store_settings has sync_backend_url/sync_terminal_id/sync_device_secret
    // (set via the Settings screen once a terminal is paired through IMS).
    sync.start();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

start().catch((err) => {
  console.error('Failed to start POS sidecar:', err);
  process.exit(1);
});
