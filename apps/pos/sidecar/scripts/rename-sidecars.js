// Renames pkg outputs to Tauri sidecar naming convention:
// dist/backend-server-macos     → ../src-tauri/binaries/backend-server-aarch64-apple-darwin
// dist/backend-server-win.exe   → ../src-tauri/binaries/backend-server-x86_64-pc-windows-msvc.exe
// dist/backend-server-linux     → ../src-tauri/binaries/backend-server-x86_64-unknown-linux-gnu
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = path.join(__dirname, '..', '..', 'src-tauri', 'binaries');

const MAP = [
  ['backend-server-macos-arm64', 'backend-server-aarch64-apple-darwin'],
  ['backend-server-win-x64.exe', 'backend-server-x86_64-pc-windows-msvc.exe'],
  ['backend-server-linux-x64', 'backend-server-x86_64-unknown-linux-gnu'],
];

// pkg has been observed to still be flushing an output file to disk right as
// it exits -- existsSync can see the entry while an immediate copyFileSync
// still throws ENOENT. A couple of short retries absorbs that without
// masking a genuinely missing file (which will still fail after these).
function copyWithRetry(srcPath, dstPath, attemptsLeft = 5) {
  try {
    fs.copyFileSync(srcPath, dstPath);
  } catch (err) {
    if (err.code === 'ENOENT' && attemptsLeft > 0) {
      setTimeout(() => copyWithRetry(srcPath, dstPath, attemptsLeft - 1), 200);
      return;
    }
    throw err;
  }
  fs.chmodSync(dstPath, 0o755);
  console.log(`✓ ${path.basename(srcPath)} → ${path.basename(dstPath)}`);
}

MAP.forEach(([src, dst]) => {
  const srcPath = path.join(DIST, src);
  const dstPath = path.join(OUT, dst);
  if (fs.existsSync(srcPath)) {
    copyWithRetry(srcPath, dstPath);
  }
});
