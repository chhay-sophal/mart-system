// ESC/POS byte sequences for receipt printers (Epson TM, Xprinter, Rongta and
// the many compatibles).

const ESC = 0x1b;
const GS = 0x1d;

export const INIT = [ESC, 0x40]; // ESC @: reset to defaults
// GS V 1: partial cut right where the paper is. Not GS V B ("feed to the
// cutter, then cut"): many printers don't feed for it, and this job has
// already fed the receipt past the blade (BLADE_CLEARANCE_LINES).
const PARTIAL_CUT = [GS, 0x56, 0x01];
// ESC p 0 t1 t2: pulse drawer pin 2 (the usual RJ-11 drawer port) for 50 ms on, 500 ms off.
export const OPEN_DRAWER = [ESC, 0x70, 0x00, 0x19, 0xfa];

// Blank space after the receipt is printed as white rows at the bottom of the
// receipt image, not with a feed command (ESC d): some printers ignore a feed
// right after an image, but every printer advances the paper for image rows.
// One "line" is 1/6 inch, the usual text line, at 203 dpi.
const LINE_DOTS = 34;

// The tear bar -- or the cutter blade, on a printer that has one -- sits 1-2
// cm above the print head. This many extra lines of paper move the last
// printed line past it, so it isn't torn or cut through.
const BLADE_CLEARANCE_LINES = 4;

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

/** The image with `rows` white rows added at the bottom. */
function withBlankRows({ width, height, bytes }, rows) {
  const padded = new Uint8Array(bytes.length + (width / 8) * rows); // zero bytes print white
  padded.set(bytes);
  return { width, height: height + rows, bytes: padded };
}

/**
 * A complete print job: each copy is the receipt image with `feedLines` blank
 * lines under it plus room to clear the tear bar or blade, then a cut when the
 * printer has a cutter. The cutter setting never changes the receipt's length.
 */
export function receiptJob(image, { cut = true, feedLines = 3, copies = 1 } = {}) {
  const blankLines = feedLines + BLADE_CLEARANCE_LINES;
  const printed = rasterImage(withBlankRows(image, blankLines * LINE_DOTS));
  const one = Uint8Array.from(cut ? [...printed, ...PARTIAL_CUT] : printed);
  const out = new Uint8Array(INIT.length + one.length * copies);
  out.set(INIT);
  for (let i = 0; i < copies; i++) out.set(one, INIT.length + i * one.length);
  return out;
}

export const drawerJob = () => Uint8Array.from([...INIT, ...OPEN_DRAWER]);
