import { FileClock, Play, Trash2, X } from 'lucide-react';
import { translations as t } from './locales';
import { usdToKhr } from './khr';

// A draft's total before any sale-wide discount, in the store's main currency.
function draftTotal(cart, mainCurrency, rate) {
  const usd = cart.reduce((sum, item) => {
    const base = item.currency === 'KHR' ? item.price / rate : Number(item.price);
    let unit = base;
    if (item.discount > 0) {
      unit = item.discountType === 'fixed'
        ? Math.max(0, base - (item.currency === 'KHR' ? item.discount / rate : item.discount))
        : base * (1 - item.discount / 100);
    }
    return sum + unit * item.quantity;
  }, 0);
  return mainCurrency === 'KHR' ? `${usdToKhr(usd, rate).toLocaleString()} ៛` : `$${usd.toFixed(2)}`;
}

const time = (value, locale) =>
  new Date(String(value).replace(' ', 'T')).toLocaleTimeString(locale === 'km' ? 'km-KH' : 'en-US', { hour: '2-digit', minute: '2-digit' });

/**
 * The register's draft carts (issue #1): sales set aside mid-checkout. Resume
 * puts one back in the cart (setting aside whatever is in it now first).
 */
export default function DraftsDialog({ drafts, locale, mainCurrency, dynamicRate, onResume, onDelete, onClose }) {
  const s = t[locale]?.drafts || t.en.drafts;
  return (
    <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl max-w-lg w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"><FileClock size={18} /> {s.title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer" aria-label={s.close}>
            <X size={18} />
          </button>
        </div>

        {drafts.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">{s.none}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl max-h-[60vh] overflow-y-auto">
            {drafts.map((draft) => {
              const count = draft.cart.reduce((sum, item) => sum + item.quantity, 0);
              const names = draft.cart.map((item) => item.name).join(', ');
              return (
                <li key={draft.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {time(draft.created_at, locale)} · {((count === 1 ? s.item : s.items) || '{n} items').replace('{n}', count)} · {draftTotal(draft.cart, mainCurrency, dynamicRate)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={names}>{names}</p>
                  </div>
                  <button type="button" onClick={() => onDelete(draft)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                    title={s.delete} aria-label={s.delete}>
                    <Trash2 size={14} />
                  </button>
                  <button type="button" onClick={() => onResume(draft)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer">
                    <Play size={12} /> {s.resume}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-slate-400 dark:text-slate-400">{s.note}</p>
      </div>
    </div>
  );
}
