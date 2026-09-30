const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const khr = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatPrice(amount, currency) {
  return currency === 'KHR' ? `៛${khr.format(amount)}` : usd.format(amount);
}

export const STOCK_LABEL = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

export const STOCK_TEXT_CLASS = {
  IN_STOCK: 'text-ok',
  LOW_STOCK: 'text-low',
  OUT_OF_STOCK: 'text-muted',
};

// Product.category is free text set in IMS, so aisle tints are assigned by
// hashing the name into the design's pastel set rather than a fixed map.
const TINTS = ['#dce9ef', '#f2e5cc', '#e2ecd6', '#f6ddd0', '#e8e1ee', '#e6e4dc'];

export function aisleTint(category) {
  if (!category) return TINTS[5];
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export const UNCATEGORIZED = 'Other';
export const aisleOf = (product) => product.category || UNCATEGORIZED;
