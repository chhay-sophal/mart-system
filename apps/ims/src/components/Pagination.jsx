import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt } from '../i18n/translate';

/**
 * "1–50 of 312" with Previous / Page x of y / Next, for a usePagination
 * pager. Renders nothing when everything fits on one page.
 */
export default function Pagination({ pager }) {
  const { t } = useLocale();
  const { page, pageCount, pageSize, total, setPage } = pager;
  if (pageCount <= 1) return null;

  const button = 'px-3 py-1 border border-[var(--border)] rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-default';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm text-slate-600 dark:text-slate-300">
      <span className="tabular-nums">
        {fmt(t.common.rangeOf, { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className={button}>
          {t.common.previous}
        </button>
        <span className="tabular-nums">{fmt(t.common.page, { page, pages: pageCount })}</span>
        <button type="button" disabled={page === pageCount} onClick={() => setPage(page + 1)} className={button}>
          {t.common.next}
        </button>
      </div>
    </div>
  );
}
