// Phase 0 spike: confirms `@yao-pkg/pkg` can bundle this sidecar (including sql.js's
// wasm asset) when its dependencies live in a pnpm workspace's symlinked node_modules.
// Not the real POS sidecar yet — that's ported from online-pos/backend-desktop in Phase 2.
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const initSqlJs = require('sql.js');

async function main() {
  // Under pkg, WASM lives in the virtual snapshot filesystem, but
  // WebAssembly.instantiate needs a real OS path — extract it once.
  let wasmDir;
  if (process.pkg) {
    const wasmSrc = path.join(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
    const wasmDest = path.join(os.tmpdir(), 'sql-wasm.wasm');
    fs.writeFileSync(wasmDest, fs.readFileSync(wasmSrc));
    wasmDir = os.tmpdir();
  } else {
    wasmDir = path.join(__dirname, 'node_modules/sql.js/dist/');
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmDir, file),
  });
  const db = new SQL.Database();
  db.run('CREATE TABLE IF NOT EXISTS ping (id INTEGER PRIMARY KEY, message TEXT)');

  const app = express();
  app.use(cors());
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, () => {
    console.log(`PORT:${server.address().port}`);
  });
}

main();
