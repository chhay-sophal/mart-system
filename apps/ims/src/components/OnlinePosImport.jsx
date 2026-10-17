import { Fragment, useRef, useState } from 'react';
import { apiClient } from '../lib/apiClient';
import { queryClient, queryKeys } from '../lib/queryClient';
import { openOnlinePosDb, readOrders, readProducts, readSettings, sourceIdFor } from '../lib/onlinePosFile';
import { importProductsInBatches } from '../lib/productImport';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { fmt, plural } from '../i18n/translate';

// ~350 bytes per order with a couple of items, so 100 stays far under the
// backend's 100KB body limit even for big baskets.
const ORDER_BATCH_SIZE = 100;
const SHOWN_ERRORS = 10;

// Labels in t.importExport.onlinePos.settingLabels.
const SETTING_KEYS = ['main_currency', 'locale', 'exchange_rate'];

const VALID_SETTINGS = {
  main_currency: (v) => v === 'USD' || v === 'KHR',
  locale: (v) => v === 'km' || v === 'en',
  exchange_rate: (v) => Number(v) > 0,
};

function dateRange(orders) {
  const dates = orders.map((o) => o.createdAt.slice(0, 10)).filter(Boolean).sort();
  return dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '';
}

/**
 * One-time migration from the old online-pos app: reads its database.sqlite
 * and brings over store settings, products and sales history, in that order
 * (sales are matched to products by barcode, so products go first).
 */
export default function OnlinePosImport({ storeId, onImported }) {
  const { t } = useLocale();
  const op = t.importExport.onlinePos;
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null); // { name, settings, products, orders, sourceId, deletedSkipped }
  const [readError, setReadError] = useState('');
  const [include, setInclude] = useState({ settings: true, products: true, orders: true });
  const [updateExisting, setUpdateExisting] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState({}); // step -> text
  const [errors, setErrors] = useState([]);

  async function handleFile(e) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setReadError('');
    setStatus({});
    setErrors([]);
    try {
      const db = await openOnlinePosDb(await picked.arrayBuffer());
      try {
        const products = readProducts(db);
        const orders = readOrders(db);
        setFile({
          name: picked.name,
          settings: readSettings(db),
          products: products.rows,
          deletedSkipped: products.deletedSkipped,
          orders,
          sourceId: await sourceIdFor(orders),
        });
      } finally {
        db.close();
      }
    } catch (err) {
      setFile(null);
      setReadError(err?.message?.includes('online-pos') ? err.message : op.unreadable);
    }
  }

  const setStep = (step, text) => setStatus((s) => ({ ...s, [step]: text }));

  async function importSettings() {
    const { settings } = file;
    setStep('settings', op.importing);
    const values = {};
    for (const [key, isValid] of Object.entries(VALID_SETTINGS)) {
      if (settings[key] && isValid(settings[key])) values[key] = settings[key];
    }
    if (Object.keys(values).length) {
      await apiClient.put(`/api/stores/${storeId}/settings`, { settings: values });
      queryClient.invalidateQueries({ queryKey: queryKeys.storeSettings(storeId) });
    }
    setStep('settings', op.done);
  }

  async function importProducts() {
    const total = file.products.length;
    try {
      const totals = await importProductsInBatches(storeId, file.products, updateExisting, (n) =>
        setStep('products', fmt(op.importingProgress, { done: n, total }))
      );
      setStep('products', fmt(op.productsDone, totals));
    } catch (err) {
      const totals = err.partialTotals;
      const done = totals.imported + totals.updated + totals.skipped + totals.errors;
      throw new Error(fmt(op.productsStopped, { done, total }), { cause: err });
    }
  }

  async function importOrders() {
    const { orders, sourceId } = file;
    const totals = { imported: 0, skipped: 0, productsCreated: 0 };
    const orderErrors = [];
    for (let i = 0; i < orders.length; i += ORDER_BATCH_SIZE) {
      setStep('orders', fmt(op.importingProgress, { done: i, total: orders.length }));
      let res;
      try {
        res = await apiClient.post(`/api/stores/${storeId}/legacy-import/online-pos/orders`, {
          sourceId,
          orders: orders.slice(i, i + ORDER_BATCH_SIZE),
        });
      } catch (err) {
        setErrors((e) => [...e, ...orderErrors]);
        throw new Error(fmt(op.salesStopped, { done: i, total: orders.length }), { cause: err });
      }
      totals.imported += res.imported;
      totals.skipped += res.skipped;
      totals.productsCreated += res.productsCreated;
      orderErrors.push(...res.errors.map((e) => fmt(op.orderError, { id: e.legacyId, error: e.error })));
    }
    setErrors((e) => [...e, ...orderErrors]);
    setStep(
      'orders',
      fmt(totals.productsCreated ? op.ordersDoneWithCreated : op.ordersDone, {
        imported: totals.imported,
        skipped: totals.skipped,
        errors: orderErrors.length,
        created: totals.productsCreated,
      })
    );
  }

  async function handleRun() {
    setRunning(true);
    setStatus({});
    setErrors([]);
    const steps = [
      ['settings', importSettings],
      ['products', importProducts],
      ['orders', importOrders],
    ].filter(([key]) => include[key]);
    try {
      for (const [key, run] of steps) {
        try {
          await run();
        } catch (err) {
          setStep(key, err?.message || op.failed);
          break; // Later steps depend on earlier ones (sales need products).
        }
      }
    } finally {
      setRunning(false);
      onImported?.();
    }
  }

  const canRun = file && Object.values(include).some(Boolean) && !running;
  const settingEntries = file ? SETTING_KEYS.filter((key) => file.settings[key]).map((key) => [key, op.settingLabels[key]]) : [];

  return (
    <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
      <h2 className="text-sm font-semibold text-[var(--text-h)]">{op.title}</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {fillParts(op.intro, {
          file: <code>database.sqlite</code>,
          folder: <code>.soso-babymart-pos</code>,
          backups: <code>backups</code>,
        })}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={running}
          className="text-sm font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 disabled:opacity-60 cursor-pointer"
        >
          {op.chooseFile}
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{file?.name ?? op.noFileChosen}</span>
        <input ref={fileInputRef} type="file" accept=".sqlite,.sqlite3,.db" className="hidden" onChange={handleFile} />
      </div>
      {readError && <p className="text-xs text-red-600 dark:text-red-400">{readError}</p>}

      {file && (
        <div className="space-y-3 pt-2 border-t border-[var(--border)]">
          <Step
            checked={include.settings}
            disabled={running || settingEntries.length === 0}
            onChange={(v) => setInclude({ ...include, settings: v })}
            title={op.storeSettings}
            status={status.settings}
          >
            {settingEntries.length === 0 ? (
              op.noSettings
            ) : (
              <>
                {settingEntries.map(([key, label]) => (
                  <span key={key} className="block">
                    {label}: {file.settings[key]}
                    {VALID_SETTINGS[key] && !VALID_SETTINGS[key](file.settings[key]) && ` ${op.invalidSetting}`}
                  </span>
                ))}
                <span className="block">{op.registerSettingsNote}</span>
                <span className="block text-amber-700 dark:text-amber-300">{op.replacesNote}</span>
              </>
            )}
          </Step>

          <Step
            checked={include.products}
            disabled={running}
            onChange={(v) => setInclude({ ...include, products: v })}
            title={fmt(op.productsTitle, { count: file.products.length })}
            status={status.products}
          >
            {file.deletedSkipped > 0 && (
              <span className="block">
                {fmt(plural(file.deletedSkipped, op.deletedLeftOutOne, op.deletedLeftOutMany), {
                  count: file.deletedSkipped,
                })}
              </span>
            )}
            <label className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                checked={updateExisting}
                disabled={running}
                onChange={(e) => setUpdateExisting(e.target.checked)}
              />
              {op.updateExisting}
            </label>
          </Step>

          <Step
            checked={include.orders}
            disabled={running || file.orders.length === 0}
            onChange={(v) => setInclude({ ...include, orders: v })}
            title={fmt(plural(file.orders.length, op.salesTitleOne, op.salesTitleMany), { count: file.orders.length })}
            status={status.orders}
          >
            {file.orders.length > 0 && <span className="block">{dateRange(file.orders)}</span>}
            <span className="block">{op.salesNote}</span>
          </Step>

          {errors.length > 0 && (
            <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-lg p-3 space-y-0.5">
              {errors.slice(0, SHOWN_ERRORS).map((e) => (
                <p key={e}>{e}</p>
              ))}
              {errors.length > SHOWN_ERRORS && <p>{fmt(op.moreErrors, { count: errors.length - SHOWN_ERRORS })}</p>}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5 disabled:opacity-60 cursor-pointer"
            >
              {running ? op.importing : op.importSelected}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// fmt() for JSX: fills {name} placeholders with elements instead of text.
function fillParts(template, parts) {
  return template.split(/\{(\w+)\}/).map((piece, i) =>
    i % 2 ? <Fragment key={i}>{parts[piece] ?? `{${piece}}`}</Fragment> : piece
  );
}

function Step({ checked, disabled, onChange, title, status, children }) {
  return (
    <div className="flex gap-3">
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-h)]">{title}</p>
        <div className="text-xs text-slate-500 dark:text-slate-400">{children}</div>
        {status && <p className="text-xs font-medium text-slate-700 dark:text-slate-200 mt-1">{status}</p>}
      </div>
    </div>
  );
}
