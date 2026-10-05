// Draws receipt blocks (receiptModel.js) onto a canvas exactly as wide as the
// printer's print head, then turns it into 1-bit rows for ESC/POS raster
// printing. Printing an image rather than text is what lets Khmer (and ៛)
// print correctly: thermal printers have no Khmer characters of their own.

// Printable dots across at 203 dpi.
export const PAPER_DOTS = { 58: 384, 80: 576 };

const FONT_FAMILY = '"Kantumruy Pro", "Noto Sans Khmer", "Khmer UI", "Leelawadee UI", sans-serif';
const BASE_SIZE = { 58: 22, 80: 26 }; // font px per paper width
const SIZE_SCALE = { sm: 0.85, md: 1, lg: 1.35 };
const LINE_HEIGHT = 1.45;
const GAP = 8; // space between label and value
const INK_THRESHOLD = 160; // darker than this (0-255) prints

const fontFor = (px, bold) => `${bold ? 700 : 500} ${px}px ${FONT_FAMILY}`;

/** Waits for the receipt font (Google Fonts, see index.html); system fonts if offline. */
async function loadFonts(base) {
  if (!document.fonts?.load) return;
  const sample = 'Aក៛$1';
  await Promise.allSettled([
    document.fonts.load(fontFor(base, false), sample),
    document.fonts.load(fontFor(base, true), sample),
  ]);
}

// Break on words where the language has them (Khmer has no spaces, so this
// relies on the browser's dictionary segmentation), else on characters.
const segmenter = (granularity) =>
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity }) : null;
const WORDS = segmenter('word');
const GRAPHEMES = segmenter('grapheme');
const split = (text, seg) => (seg ? [...seg.segment(text)].map((s) => s.segment) : [...text]);

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  const push = (piece) => {
    const next = line + piece;
    if (ctx.measureText(next).width <= maxWidth || line === '') {
      line = next;
    } else {
      lines.push(line.trimEnd());
      line = piece.trimStart();
    }
  };
  for (const word of split(String(text), WORDS)) {
    if (ctx.measureText(word).width > maxWidth) split(word, GRAPHEMES).forEach(push);
    else push(word);
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

function layout(ctx, blocks, width, base, draw) {
  const margin = 4;
  const inner = width - margin * 2;
  let y = margin;

  const text = (str, x, size, bold, align = 'left') => {
    ctx.font = fontFor(base * SIZE_SCALE[size], bold);
    ctx.textAlign = align;
    if (draw) ctx.fillText(str, x, y);
  };
  const lineHeight = (size) => Math.round(base * SIZE_SCALE[size] * LINE_HEIGHT);

  // Label on the left, value on the right; a label that doesn't fit beside
  // the value wraps above it.
  const pair = (left, right, size = 'md', bold = false, indent = 0) => {
    ctx.font = fontFor(base * SIZE_SCALE[size], bold);
    const rightWidth = right ? ctx.measureText(right).width : 0;
    const room = inner - indent;
    if (left && right && ctx.measureText(left).width + GAP + rightWidth > room && rightWidth > room / 2) {
      // Too wide to share a line: label above, value below.
      pair(left, '', size, bold, indent);
      pair('', right, size, bold, indent);
      return;
    }
    const lines = left ? wrap(ctx, left, inner - indent - rightWidth - GAP) : [''];
    lines.forEach((l, i) => {
      text(l, margin + indent, size, bold);
      if (i === lines.length - 1 && right) text(right, width - margin, size, bold, 'right');
      y += lineHeight(size);
    });
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'text': {
        const size = block.size || 'md';
        ctx.font = fontFor(base * SIZE_SCALE[size], block.bold);
        const x = block.align === 'center' ? width / 2 : margin;
        for (const l of wrap(ctx, block.text, inner)) {
          text(l, x, size, block.bold, block.align === 'center' ? 'center' : 'left');
          y += lineHeight(size);
        }
        break;
      }
      case 'pair':
        pair(block.left, block.right, block.size, block.bold);
        break;
      case 'item': {
        ctx.font = fontFor(base, true);
        const indent = Math.ceil(ctx.measureText('00. ').width);
        text(block.no, margin, 'md', true);
        ctx.font = fontFor(base, true);
        for (const l of wrap(ctx, block.name, inner - indent)) {
          text(l, margin + indent, 'md', true);
          y += lineHeight('md');
        }
        pair(block.detail, block.amount, 'md', false, indent);
        if (block.note) pair(block.note, '', 'sm', false, indent);
        y += 2;
        break;
      }
      case 'rule': {
        const mid = y + 6;
        if (draw) for (let x = margin; x < width - margin; x += 8) ctx.fillRect(x, mid, 5, 2);
        y += 14;
        break;
      }
      case 'space':
        y += lineHeight('md');
        break;
      default:
        break;
    }
  }
  return Math.ceil(y + margin);
}

/**
 * Renders the receipt and returns it as 1-bit rows: `bytes` holds `height`
 * rows of `width / 8` bytes, most significant bit = leftmost dot, 1 = black.
 */
export async function renderReceipt(blocks, paper = 58) {
  const width = PAPER_DOTS[paper] || PAPER_DOTS[58];
  const base = BASE_SIZE[paper] || BASE_SIZE[58];
  await loadFonts(base);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 1;
  const measure = canvas.getContext('2d');
  measure.textBaseline = 'top';
  const height = layout(measure, blocks, width, base, false);

  canvas.height = height; // resets the context
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  layout(ctx, blocks, width, base, true);

  return { width, height, bytes: toBits(ctx.getImageData(0, 0, width, height).data, width, height), canvas };
}

function toBits(rgba, width, height) {
  const rowBytes = width / 8;
  const bytes = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (luminance < INK_THRESHOLD) bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return bytes;
}
