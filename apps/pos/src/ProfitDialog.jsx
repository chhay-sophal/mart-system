import { useEffect, useState } from 'react';
import { TrendingUp, X } from 'lucide-react';
import { usdToKhr } from './khr';

/**
 * Checkout > Show profit (Settings > General, PIN-gated): profit on each cart
 * line and on the whole sale, as it stands right now. Same rules as the daily
 * summary: a line's revenue is what it charges after its item discount, plus
 * its share of the sale-wide discount; a product with no cost price has no
 * known profit, and is left out of the total rather than counted as all profit.
 *
 * Costs are fetched only when this opens, so they never sit in the cart.
 */
export default function ProfitDialog({ client, cart, rate, mainCurrency, subtotalUsd, totalUsd, t = {}, onClose }) {
  const [costs, setCosts] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ids = [...new Set(cart.map((item) => item.id))].join(',');
    client
      .get(`/api/products/costs?ids=${ids}`)
      .then((rows) => setCosts(new Map(rows.map((row) => [row.id, row]))))
      .catch(() => setFailed(true));
  }, [cart, client]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toUsd = (amount, currency) => (currency === 'KHR' ? amount / rate : Number(amount));
  const fmt = (usd) => {
    const sign = usd < 0 ? '−' : '';
    return mainCurrency === 'KHR'
      ? `${sign}${usdToKhr(Math.abs(usd), rate).toLocaleString()} ៛`
      : `${sign}$${Math.abs(usd).toFixed(2)}`;
  };

  // The sale-wide discount, spread over the lines in proportion to each.
  const share = subtotalUsd > 0 ? totalUsd / subtotalUsd : 1;
  const lines = cart.map((item) => {
    const base = toUsd(item.price, item.currency);
    let unit = base;
    if (item.discount > 0) {
      unit = item.discountType === 'fixed'
        ? Math.max(0, base - toUsd(item.discount, item.currency))
        : base * (1 - item.discount / 100);
    }
    const fullPrice = base * item.quantity;
    const afterItemDiscount = unit * item.quantity;
    const revenue = afterItemDiscount * share;
    const cost = costs?.get(item.id);
    const costUsd = cost?.cost != null ? toUsd(cost.cost, cost.currency) * item.quantity : null;
    return {
      item,
      fullPrice,
      itemDiscount: fullPrice - afterItemDiscount,
      invoiceDiscount: afterItemDiscount - revenue,
      revenue,
      cost: costUsd,
      profit: costUsd != null ? revenue - costUsd : null,
    };
  });
  const sum = (rows, key) => rows.reduce((total, line) => total + line[key], 0);
  const costed = lines.filter((line) => line.profit != null);
  const totalProfit = sum(costed, 'profit');
  const costedRevenue = sum(costed, 'revenue');
  const uncosted = lines.length - costed.length;
  const itemDiscounts = sum(lines, 'itemDiscount');
  const invoiceDiscount = sum(lines, 'invoiceDiscount');
  // Below a hundredth of a cent is float noise, not a discount.
  const some = (usd) => usd > 0.00001;
  const COLS = 'grid grid-cols-[1fr_32px_72px_72px_72px_72px_72px] gap-2';

  const profitColor = (usd) => (usd < 0 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400');

  return (
    <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-600 dark:text-emerald-400" />
            {t.title || 'Profit on this sale'}
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer" aria-label={t.close || 'Close'}>
            <X size={16} />
          </button>
        </div>

        {failed ? (
          <p className="px-5 py-6 text-sm text-rose-600 dark:text-rose-400">{t.loadFailed || "Couldn't load cost prices."}</p>
        ) : !costs ? (
          <p className="px-5 py-6 text-sm text-slate-400 dark:text-slate-500">{t.loading || 'Loading…'}</p>
        ) : (
          <>
            <div className="px-5 py-3 overflow-y-auto">
              <div className={`${COLS} text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2`}>
                <span>{t.item || 'Item'}</span>
                <span className="text-center">{t.qty || 'Qty'}</span>
                <span className="text-right">{t.price || 'Price'}</span>
                <span className="text-right">{t.discount || 'Discount'}</span>
                <span className="text-right">{t.revenue || 'Revenue'}</span>
                <span className="text-right">{t.cost || 'Cost'}</span>
                <span className="text-right">{t.profit || 'Profit'}</span>
              </div>
              <div className="space-y-1.5">
                {lines.map(({ item, fullPrice, itemDiscount, invoiceDiscount: lineInvoiceDiscount, revenue, cost, profit }) => (
                  <div key={item.lineId} className={`${COLS} text-xs items-baseline`}>
                    <span className="text-slate-800 dark:text-slate-100 font-medium truncate">{item.name}</span>
                    <span className="text-center text-slate-600 dark:text-slate-300 font-bold">{item.quantity}</span>
                    <span className="text-right text-slate-600 dark:text-slate-300">{fmt(fullPrice)}</span>
                    {/* The line's own discount, then its share of the invoice discount underneath. */}
                    <span className="text-right text-amber-600 dark:text-amber-400">
                      {some(itemDiscount) || some(lineInvoiceDiscount) ? `−${fmt(itemDiscount + lineInvoiceDiscount)}` : '—'}
                      {some(itemDiscount) && some(lineInvoiceDiscount) && (
                        <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                          {fmt(itemDiscount)} + {fmt(lineInvoiceDiscount)}
                        </span>
                      )}
                    </span>
                    <span className="text-right text-slate-800 dark:text-slate-100 font-semibold">{fmt(revenue)}</span>
                    <span className="text-right text-slate-600 dark:text-slate-300">{cost != null ? fmt(cost) : '—'}</span>
                    <span className={`text-right font-bold ${profit != null ? profitColor(profit) : 'text-slate-400 dark:text-slate-500'}`}>
                      {profit != null ? fmt(profit) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 space-y-1">
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{t.subtotal || 'Subtotal'}</span>
                <span>{fmt(sum(lines, 'fullPrice'))}</span>
              </div>
              {some(itemDiscounts) && (
                <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400">
                  <span>{t.itemDiscounts || 'Item discounts'}</span>
                  <span>−{fmt(itemDiscounts)}</span>
                </div>
              )}
              {some(invoiceDiscount) && (
                <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400">
                  <span>{t.invoiceDiscount || 'Invoice discount'}</span>
                  <span>−{fmt(invoiceDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                <span>{t.total || 'Total'}</span>
                <span>{fmt(totalUsd)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{t.totalCost || 'Cost'}</span>
                <span>−{fmt(sum(costed, 'cost'))}</span>
              </div>
              <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-100 dark:border-slate-700">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{t.totalProfit || 'Total profit'}</span>
                <span className={`text-xl font-black ${profitColor(totalProfit)}`}>{fmt(totalProfit)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>{t.margin || 'Margin'}</span>
                <span>{costedRevenue > 0 ? `${((totalProfit / costedRevenue) * 100).toFixed(1)}%` : '—'}</span>
              </div>
              {some(invoiceDiscount) && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
                  {t.discountNote || "The sale's discount is shared across the items by their price."}
                </p>
              )}
              {uncosted > 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">
                  {(t.uncostedNote || "Items marked — have no cost price, so they aren't in the cost or profit ({amount} of the total).").replace(
                    '{amount}',
                    fmt(totalUsd - costedRevenue)
                  )}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
