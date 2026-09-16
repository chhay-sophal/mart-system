require('dotenv').config();

const db = require('./src/db');
const { createApp } = require('./src/app');

const PORT = process.env.PORT ? Number(process.env.PORT) : 0;

async function start() {
  await db.init();

  const app = createApp();
  const server = app.listen(PORT, '127.0.0.1', () => {
    const actualPort = server.address().port;
    console.log(`PORT:${actualPort}`);
    console.log(`Mart System POS sidecar running on port ${actualPort}`);
    console.log(`Data: ${db.DB_PATH}`);
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
