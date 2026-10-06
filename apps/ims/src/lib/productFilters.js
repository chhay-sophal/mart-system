// Search, per-column filters and sorting for IMS Products (issue #8). All in
// the browser on the cached product list, so results update as you type.

export const EMPTY_FILTERS = {
  search: '', // name or barcode
  name: '',
  barcode: '',
  barcodeMode: 'any', // any | missing
  currency: 'all', // all | USD | KHR
  priceMin: '',
  priceMax: '',
  stock: 'all', // all | low | out | negative | in
  status: 'active', // active | archived | all
};

export const STOCK_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out (0 or less)' },
  { value: 'negative', label: 'Negative' },
  { value: 'in', label: 'In stock' },
];

export const STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

/** The price a register sells at: the store's override if set, else the default. */
export const effectivePrice = (p) => Number(p.priceOverride ?? p.defaultPrice);

const norm = (value) => String(value ?? '').trim().toLowerCase();

function matchesStock(p, mode) {
  switch (mode) {
    case 'low':
      return p.stock <= p.lowStockThreshold;
    case 'out':
      return p.stock <= 0;
    case 'negative':
      return p.stock < 0;
    case 'in':
      return p.stock > 0;
    default:
      return true;
  }
}

function matchesStatus(p, mode) {
  switch (mode) {
    case 'archived':
      return p.isDeleted;
    case 'all':
      return true;
    default: // 'active'
      return !p.isDeleted;
  }
}

export function filterProducts(products, f) {
  const search = norm(f.search);
  const name = norm(f.name);
  const barcode = norm(f.barcode);
  const min = f.priceMin === '' ? null : Number(f.priceMin);
  const max = f.priceMax === '' ? null : Number(f.priceMax);
  return products.filter((p) => {
    const pName = norm(p.name);
    const pBarcode = norm(p.barcode);
    if (search && !pName.includes(search) && !pBarcode.includes(search)) return false;
    if (name && !pName.includes(name)) return false;
    if (f.barcodeMode === 'missing' ? pBarcode !== '' : barcode && !pBarcode.includes(barcode)) return false;
    if (f.currency !== 'all' && p.currency !== f.currency) return false;
    const price = effectivePrice(p);
    if (min !== null && !(price >= min)) return false;
    if (max !== null && !(price <= max)) return false;
    if (!matchesStatus(p, f.status)) return false;
    return matchesStock(p, f.stock);
  });
}

// Price sorts within each currency (USD before KHR): without a rate, $1 and
// 4,100 ៛ can't be ranked against each other.
const COMPARE = {
  name: (a, b) => a.name.localeCompare(b.name),
  barcode: (a, b) => (a.barcode ?? '').localeCompare(b.barcode ?? ''),
  price: (a, b) => a.currency.localeCompare(b.currency) * -1 || effectivePrice(a) - effectivePrice(b),
  stock: (a, b) => a.stock - b.stock,
  status: (a, b) => Number(a.isDeleted) - Number(b.isDeleted),
};

export function sortProducts(products, { col, dir }) {
  const compare = COMPARE[col];
  if (!compare) return products;
  const sign = dir === 'desc' ? -1 : 1;
  // Ties fall back to name, so the order is stable and predictable.
  return [...products].sort((a, b) => sign * compare(a, b) || COMPARE.name(a, b));
}

export const activeFilterCount = (f) =>
  Object.entries(EMPTY_FILTERS).filter(([key, empty]) => key !== 'search' && f[key] !== empty).length;
