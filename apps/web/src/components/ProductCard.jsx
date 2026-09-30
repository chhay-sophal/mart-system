import { Link } from 'react-router-dom';
import { useCart } from '../state/CartContext.jsx';
import { aisleTint, formatPrice, STOCK_LABEL, STOCK_TEXT_CLASS } from '../lib/format.js';
import { PlusIcon } from './Icons.jsx';

export default function ProductCard({ product }) {
  const { add, lines } = useCart();
  const inCart = lines[product.id] ?? 0;
  const soldOut = product.stockLevel === 'OUT_OF_STOCK';

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-3 md:p-3.5">
      <Link to={`/products/${product.id}`} className="flex flex-col gap-3 text-ink no-underline">
        {/* Product photos aren't in the catalog yet (Product.imageUrl is deferred) — an aisle-tinted tile stands in. */}
        <div className="h-28 rounded-xl md:h-40" style={{ backgroundColor: aisleTint(product.category) }} aria-hidden="true" />
        <span className="line-clamp-2 min-h-10 text-[15px] leading-snug font-semibold">{product.name}</span>
      </Link>
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-display text-xl font-bold">{formatPrice(product.price, product.currency)}</span>
          <span className={`text-xs font-semibold ${STOCK_TEXT_CLASS[product.stockLevel]}`}>
            {inCart > 0 ? `${inCart} in cart` : STOCK_LABEL[product.stockLevel]}
          </span>
        </div>
        <button
          type="button"
          onClick={() => add(product)}
          disabled={soldOut}
          aria-label={soldOut ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted"
        >
          <PlusIcon className="size-5" />
        </button>
      </div>
    </div>
  );
}
