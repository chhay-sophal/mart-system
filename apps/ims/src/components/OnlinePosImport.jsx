import { useRef, useState } from 'react';
import { apiClient } from '../lib/apiClient';
import { openOnlinePosDb, readOrders, readProducts, readSettings, sourceIdFor } from '../lib/onlinePosFile';
import { importProductsInBatches } from '../lib/productImport';

// ~350 bytes per order with a couple of items, so 100 stays far under the
// backend's 100KB body limit even for big baskets.
const ORDER_BATCH_SIZE = 100;
const SHOWN_ERRORS = 10;

const SETTING_LABELS = {
  main_currency: 'Main currency',
  locale: 'Language',
  exchange_rate: 'Exchange rate',
};

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
      setReadError(err?.message?.includes('online-pos') ? err.message : 'Could not read that file as an online-pos database.');
    }
  }

  const setStep = (step, text) => setStatus((s) => ({ ...s, [step]: text }));

  async function importSettings() {
    const { settings } = file;
    setStep('settings', 'Importing…');
    const values = {};
    for (const [key, isValid] of Object.entries(VALID_SETTINGS)) {
      if (settings[key] && isValid(settings[key])) values[key] = settings[key];
    }
    if (Object.keys(values).length) await apiClient.put(`/api/stores/${storeId}/settings`, { settings: values });
    setStep('settings', 'Done.');
  }

  async function importProducts() {
    const total = file.products.length;
    try {
      const t = await importProductsInBatches(storeId, file.products, updateExisting, (n) =>
        setStep('products', `Importing… ${n} / ${total}`)
      );
      setStep('products', `Done: ${t.imported} imported, ${t.updated} updated, ${t.skipped} skipped, ${t.errors} errors.`);
    } catch (err) {
      const t = err.partialTotals;
      throw new Error(`Products stopped after ${t.imported + t.updated + t.skipped + t.errors} of ${total} rows.`, {
        cause: err,
      });
    }
  }

  async function importOrders() {
    const { orders, sourceId } = file;
    const totals = { imported: 0, skipped: 0, productsCreated: 0 };
    const orderErrors = [];
    for (let i = 0; i < orders.length; i += ORDER_BATCH_SIZE) {
      setStep('orders', `Importing… ${i} / ${orders.length}`);
      let res;
      try {
        res = await apiClient.post(`/api/stores/${storeId}/legacy-import/online-pos/orders`, {
          sourceId,
          orders: orders.slice(i, i + ORDER_BATCH_SIZE),
        });
      } catch (err) {
        setErrors((e) => [...e, ...orderErrors]);
        throw new Error(`Sales stopped after ${i} of ${orders.length} orders. Re-run to finish; imported ones are skipped.`, {
          cause: err,
        });
      }
      totals.imported += res.imported;
      totals.skipped += res.skipped;
      totals.productsCreated += res.productsCreated;
      orderErrors.push(...res.errors.map((e) => `Order #${e.legacyId}: ${e.error}`));
    }
    setErrors((e) => [...e, ...orderErrors]);
    setStep(
      'orders',
      `Done: ${totals.imported} imported, ${totals.skipped} already imported, ${orderErrors.length} errors` +
        (totals.productsCreated ? `, ${totals.productsCreated} missing products added as deleted.` : '.')
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
          setStep(key, err?.message || 'Failed.');
          break; // Later steps depend on earlier ones (sales need products).
        }
      }
    } finally {
      setRunning(false);
      onImported?.();
    }
  }

  const canRun = file && Object.values(include).some(Boolean) && !running;
  const settingEntries = file ? Object.entries(SETTING_LABELS).filter(([key]) => file.settings[key]) : [];

  return (
    <div className="bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-5 space-y-3 mb-4">
      <h2 className="text-sm font-semibold text-[var(--text-h)]">Import from online-pos</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Bring over data from the old online-pos app. Choose its <code>database.sqlite</code> (on the old PC under{' '}
        <code>.soso-babymart-pos</code>, or a file from its <code>backups</code> folder).
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={running}
          className="text-sm font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 disabled:opacity-60 cursor-pointer"
        >
          Choose file
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{file?.name ?? 'No file chosen'}</span>
        <input ref={fileInputRef} type="file" accept=".sqlite,.sqlite3,.db" className="hidden" onChange={handleFile} />
      </div>
      {readError && <p className="text-xs text-red-600 dark:text-red-400">{readError}</p>}

      {file && (
        <div className="space-y-3 pt-2 border-t border-[var(--border)]">
          <Step
            checked={include.settings}
            disabled={running || settingEntries.length === 0}
            onChange={(v) => setInclude({ ...include, settings: v })}
            title="Store settings"
            status={status.settings}
          >
            {settingEntries.length === 0 ? (
              'None found in this file.'
            ) : (
              <>
                {settingEntries.map(([key, label]) => (
                  <span key={key} className="block">
                    {label}: {file.settings[key]}
                    {VALID_SETTINGS[key] && !VALID_SETTINGS[key](file.settings[key]) && ' (invalid, will be skipped)'}
                  </span>
                ))}
                <span className="block">Shop name, image, address and phone are set on each register (POS Settings).</span>
                <span className="block text-amber-700 dark:text-amber-300">Replaces this store's current values.</span>
              </>
            )}
          </Step>

          <Step
            checked={include.products}
            disabled={running}
            onChange={(v) => setInclude({ ...include, products: v })}
            title={`Products (${file.products.length})`}
            status={status.products}
          >
            {file.deletedSkipped > 0 && <span className="block">{file.deletedSkipped} deleted products left out.</span>}
            <label className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                checked={updateExisting}
                disabled={running}
                onChange={(e) => setUpdateExisting(e.target.checked)}
              />
              Update existing products matched by barcode (otherwise they're skipped)
            </label>
          </Step>

          <Step
            checked={include.orders}
            disabled={running || file.orders.length === 0}
            onChange={(v) => setInclude({ ...include, orders: v })}
            title={`Sales history (${file.orders.length} orders)`}
            status={status.orders}
          >
            {file.orders.length > 0 && <span className="block">{dateRange(file.orders)}</span>}
            <span className="block">
              Doesn't change stock. Items are matched to products by barcode, so import products first (now or earlier).
            </span>
          </Step>

          {errors.length > 0 && (
            <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-lg p-3 space-y-0.5">
              {errors.slice(0, SHOWN_ERRORS).map((e) => (
                <p key={e}>{e}</p>
              ))}
              {errors.length > SHOWN_ERRORS && <p>…and {errors.length - SHOWN_ERRORS} more.</p>}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-1.5 disabled:opacity-60 cursor-pointer"
            >
              {running ? 'Importing…' : 'Import selected'}
            </button>
          </div>
        </div>
      )}
    </div>
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
