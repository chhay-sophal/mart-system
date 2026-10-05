// ESC/POS byte sequences for receipt printers (Epson TM, Xprinter, Rongta and
// the many compatibles).

const ESC = 0x1b;
const GS = 0x1d;

export const INIT = [ESC, 0x40]; // ESC @: reset to defaults
const feedLines = (n) => [ESC, 0x64, n]; // ESC d n
const PARTIAL_CUT = [GS, 0x56, 0x42, 0x00]; // GS V B 0: feed to the cutter, then cut
// ESC p 0 t1 t2: pulse drawer pin 2 (the usual RJ-11 drawer port) for 50 ms on, 500 ms off.
export const OPEN_DRAWER = [ESC, 0x70, 0x00, 0x19, 0xfa];

// Rows per GS v 0 command. Smaller bands keep cheap printers with little
// buffer from dropping data on long receipts.
const BAND_ROWS = 128;

/** GS v 0 raster image commands for 1-bit rows (see raster.js). */
export function rasterImage({ width, height, bytes }) {
  const rowBytes = width / 8;
  const out = [];
  for (let top = 0; top < height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - top);
    out.push(GS, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8);
    const band = bytes.subarray(top * rowBytes, (top + rows) * rowBytes);
    for (let i = 0; i < band.length; i++) out.push(band[i]);
  }
  return out;
}

/** A complete print job: the receipt image, then feed and (optionally) cut. */
export function receiptJob(image, { cut = true } = {}) {
  return Uint8Array.from([
    ...INIT,
    ...rasterImage(image),
    ...feedLines(cut ? 3 : 5),
    ...(cut ? PARTIAL_CUT : []),
  ]);
}

export const drawerJob = () => Uint8Array.from([...INIT, ...OPEN_DRAWER]);
