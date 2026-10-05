// Cart lines. A product can sit on more than one line -- e.g. 3 of an item
// with one unit discounted for a defect: split one unit onto its own line and
// discount just that line. So each line has its own `lineId`; `id` stays the
// product's id, which is what checkout sends.

let counter = 0;
const newLineId = () => `line-${Date.now().toString(36)}-${(counter++).toString(36)}`;

const newLine = (product) => ({ ...product, lineId: newLineId(), quantity: 1, discount: 0, discountType: 'pct' });

/**
 * One more of `product`: added to its undiscounted line if there is one (a
 * scan never lands on a discounted line), else on a new line -- at the top of
 * the cart, or the bottom with `{ atEnd: true }`.
 */
export function addProduct(cart, product, { atEnd = false } = {}) {
  const line = cart.find((item) => item.id === product.id && !(item.discount > 0));
  if (line) return cart.map((item) => (item.lineId === line.lineId ? { ...item, quantity: item.quantity + 1 } : item));
  return atEnd ? [...cart, newLine(product)] : [newLine(product), ...cart];
}

/** Moves one unit of a line onto its own, undiscounted line right below it. */
export function splitLine(cart, lineId) {
  const index = cart.findIndex((item) => item.lineId === lineId);
  const line = cart[index];
  if (!line || line.quantity < 2) return cart;
  const single = { ...line, lineId: newLineId(), quantity: 1, discount: 0 };
  return [...cart.slice(0, index), { ...line, quantity: line.quantity - 1 }, single, ...cart.slice(index + 1)];
}

/** How many of a product are in the cart, across all its lines. */
export const quantityOf = (cart, productId) =>
  cart.reduce((sum, item) => (item.id === productId ? sum + item.quantity : sum), 0);
