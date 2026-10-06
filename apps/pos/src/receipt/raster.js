// Draws receipt blocks (receiptModel.js) as an image exactly as wide as the
// printer's print head. The thermal printer gets it as 1-bit rows for ESC/POS
// raster printing; the system print dialog prints the image itself. Printing
// an image rather than text is what lets Khmer (and ៛) print correctly:
// thermal printers have no Khmer characters of their own.

// Printable dots across at 203 dpi, and the printed width they cover.
export const PAPER_DOTS = { 58: 384, 80: 576 };
export const PRINT_WIDTH_MM = { 58: 48, 80: 72 };

const FONT_FAMILY = '"Kantumruy Pro", "Noto Sans Khmer", "Khmer UI", "Leelawadee UI", sans-serif';
const BASE_SIZE = { 58: 22, 80: 26 }; // font px per paper width
const TEXT_SIZE_SCALE = { small: 0.85, normal: 1, large: 1.15 };
const SIZE_SCALE = { sm: 0.85, md: 1, lg: 1.35, xl: 1.65, xxl: 1.95, xxxl: 2.25 };
const LINE_HEIGHT = 1.45;
const GAP = 8; // space between label and value
const LOGO_MAX = { width: 0.5, height: 120 }; // share of the width, dots
// Darker settings print greyer pixels too (0-255: darker than this prints).
const INK_THRESHOLD = { 1: 120, 2: 140, 3: 160, 4: 185, 5: 210 };

// Font weights for regular and bold text. Kantumruy Pro is loaded at
// 300..700 (index.html), so bold tops out at 700; heavier regular text is
// what helps on a faint thermal printer.
const FONT_WEIGHTS = {
  light: { regular: 400, bold: 500 },
  normal: { regular: 500, bold: 600 },
  bold: { regular: 600, bold: 700 },
};

const fontFor = (px, bold, weight = 'normal') => {
  const w = FONT_WEIGHTS[weight] || FONT_WEIGHTS.normal;
  return `${bold ? w.bold : w.regular} ${px}px ${FONT_FAMILY}`;
};

/** Waits for the receipt font (Google Fonts, see index.html); system fonts if offline. */
async function loadFonts(base, weight) {
  if (!document.fonts?.load) return;
  const sample = 'Aក៛$1';
  await Promise.allSettled([
    document.fonts.load(fontFor(base, false, weight), sample),
    document.fonts.load(fontFor(base, true, weight), sample),
  ]);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a broken logo just isn't printed
    img.src = src;
  });
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

const logoSize = (img, width) => {
  const scale = Math.min((width * LOGO_MAX.width) / img.width, LOGO_MAX.height / img.height, 1.5);
  return { w: Math.round(img.width * scale), h: Math.round(img.height * scale) };
};

/** Floyd–Steinberg dithering to pure black/white, so a photo logo keeps its shading on a thermal printer. */
function ditherInto(ctx, img, x, y, w, h) {
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d', { willReadFrequently: true });
  t.fillStyle = '#fff';
  t.fillRect(0, 0, w, h); // transparent logo areas print as paper
  t.drawImage(img, 0, 0, w, h);
  const data = t.getImageData(0, 0, w, h);
  const px = data.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  for (let py = 0; py < h; py++) {
    for (let pxl = 0; pxl < w; pxl++) {
      const i = py * w + pxl;
      const value = gray[i] < 128 ? 0 : 255;
      const err = gray[i] - value;
      gray[i] = value;
      if (pxl + 1 < w) gray[i + 1] += (err * 7) / 16;
      if (py + 1 < h) {
        if (pxl > 0) gray[i + w - 1] += (err * 3) / 16;
        gray[i + w] += (err * 5) / 16;
        if (pxl + 1 < w) gray[i + w + 1] += err / 16;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = gray[i];
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, x, y);
}

function layout(ctx, blocks, { width, base, weight, draw, images, mono }) {
  const font = (px, bold) => fontFor(px, bold, weight);
  const margin = 4;
  const inner = width - margin * 2;
  let y = margin;

  const text = (str, x, size, bold, align = 'left') => {
    ctx.font = font(base * SIZE_SCALE[size], bold);
    ctx.textAlign = align;
    if (draw) ctx.fillText(str, x, y);
  };
  const lineHeight = (size) => Math.round(base * SIZE_SCALE[size] * LINE_HEIGHT);

  // Label on the left, value on the right; a label that doesn't fit beside
  // the value wraps above it.
  const pair = (left, right, size = 'md', bold = false, indent = 0) => {
    ctx.font = font(base * SIZE_SCALE[size], bold);
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
      case 'image': {
        const img = images.get(block.src);
        if (!img) break;
        const { w, h } = logoSize(img, width);
        const x = Math.round((width - w) / 2);
        if (draw) {
          if (mono) ditherInto(ctx, img, x, y, w, h);
          else ctx.drawImage(img, x, y, w, h);
        }
        y += h + 6;
        break;
      }
      case 'text': {
        const size = block.size || 'md';
        ctx.font = font(base * SIZE_SCALE[size], block.bold);
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
        ctx.font = font(base, false);
        const indent = block.no ? Math.ceil(ctx.measureText('00. ').width) : 0;
        if (block.no) text(block.no, margin, 'md', false);
        if (block.detail) {
          ctx.font = font(base, false);
          for (const l of wrap(ctx, block.name, inner - indent)) {
            text(l, margin + indent, 'md', false);
            y += lineHeight('md');
          }
          pair(block.detail, block.amount, 'md', false, indent);
        } else {
          pair(block.name, block.amount, 'md', false, indent); // compact: name and amount on one line
        }
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
      default:
        break;
    }
  }
  return Math.ceil(y + margin);
}

/**
 * Renders the receipt onto a canvas `PAPER_DOTS[paper]` dots wide (times
 * `scale`, for a sharper image in the print dialog).
 *   mono: draw the logo dithered, as the thermal printer will print it
 *   textSize: 'small' | 'normal' | 'large'
 *   fontWeight: 'light' | 'normal' | 'bold'
 */
export async function drawReceipt(blocks, { paper = 58, textSize = 'normal', fontWeight = 'normal', mono = true, scale = 1 } = {}) {
  const width = PAPER_DOTS[paper] || PAPER_DOTS[58];
  const base = Math.round((BASE_SIZE[paper] || BASE_SIZE[58]) * (TEXT_SIZE_SCALE[textSize] || 1));
  await loadFonts(base, fontWeight);
  const sources = [...new Set(blocks.filter((b) => b.type === 'image').map((b) => b.src))];
  const images = new Map(await Promise.all(sources.map(async (src) => [src, await loadImage(src)])));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 1;
  const measure = canvas.getContext('2d');
  measure.textBaseline = 'top';
  const height = layout(measure, blocks, { width, base, weight: fontWeight, draw: false, images });

  canvas.width = Math.round(width * scale); // resets the context
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  layout(ctx, blocks, { width, base, weight: fontWeight, draw: true, images, mono: mono && scale === 1 });
  return canvas;
}

/**
 * The receipt as 1-bit rows for the thermal printer: `bytes` holds `height`
 * rows of `width / 8` bytes, most significant bit = leftmost dot, 1 = black.
 */
export async function renderReceipt(blocks, { paper = 58, textSize = 'normal', fontWeight = 'normal', darkness = 3 } = {}) {
  const canvas = await drawReceipt(blocks, { paper, textSize, fontWeight, mono: true });
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  return { width, height, bytes: toBits(rgba, width, height, INK_THRESHOLD[darkness] || INK_THRESHOLD[3]), canvas };
}

function toBits(rgba, width, height, threshold) {
  const rowBytes = width / 8;
  const bytes = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (luminance < threshold) bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return bytes;
}

/** What the thermal printer will print, as a canvas (for the Settings preview). */
export function bitsToCanvas({ width, height, bytes }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = bytes[y * (width / 8) + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255;
      const i = (y * width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
