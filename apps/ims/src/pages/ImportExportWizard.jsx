import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Modal from '../components/Modal.jsx';
import { apiClient } from '../lib/apiClient';

// Ported from online-pos/frontend/src/StockManager.jsx — same field keys, same
// auto-detection heuristic. Tauri-specific drag-drop (invoke('read_file_bytes'))
// is dropped; the plain <input type="file"> + HTML5 drag-drop path already
// covers every browser, including inside a Tauri webview if this ever needs it.
const IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'price', label: 'Price', required: true },
  { key: 'barcode', label: 'Barcode', required: false },
  { key: 'cost_price', label: 'Cost price', required: false },
  { key: 'currency', label: 'Currency', required: false },
  { key: 'stock', label: 'Stock', required: false },
];

const IMPORT_HINTS = {
  name: ['name', 'productname', 'itemname', 'description', 'product', 'item', 'title'],
  price: ['price', 'retailprice', 'sellingprice', 'unitprice', 'saleprice', 'salesprice'],
  barcode: ['barcode', 'sku', 'code', 'upc', 'ean', 'isbn', 'productcode'],
  cost_price: ['cost', 'costprice', 'purchaseprice', 'buyprice', 'wholesale', 'costofgoods'],
  currency: ['currency', 'curr', 'unit'],
  stock: ['stock', 'qty', 'quantity', 'instock', 'stockcount', 'inventory', 'available'],
};

function autoDetectMapping(headers) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, '']));
  const used = new Set();
  for (const [field, hints] of Object.entries(IMPORT_HINTS)) {
    for (const hint of hints) {
      const match = headers.find((h) => !used.has(h) && norm(h) === hint);
      if (match) {
        mapping[field] = match;
        used.add(match);
        break;
      }
    }
  }
  return mapping;
}

const EXPORT_COLUMNS = [
  { key: 'name', header: 'Name', wch: 28, val: (p) => p.name },
  { key: 'barcode', header: 'Barcode', wch: 16, val: (p) => p.barcode ?? '' },
  { key: 'currency', header: 'Currency', wch: 10, val: (p) => p.currency },
  { key: 'price', header: 'Price', wch: 10, val: (p) => Number(p.defaultPrice) },
  { key: 'costPrice', header: 'Cost price', wch: 10, val: (p) => Number(p.costPrice) },
  { key: 'stock', header: 'Stock', wch: 10, val: (p) => p.stock },
  { key: 'lowStockThreshold', header: 'Low-stock threshold', wch: 12, val: (p) => p.lowStockThreshold },
];

export default function ImportExportWizard({ storeId, products, onClose, onImported }) {
  const [tab, setTab] = useState('import'); // 'import' | 'export'

  const [step, setStep] = useState('upload'); // 'upload' | 'map' | 'result'
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [updateExisting, setUpdateExisting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const [exportCols, setExportCols] = useState(() =>
    Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.key, true]))
  );

  function processFileBuffer(buffer) {
    try {
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (raw.length < 2) {
        setError('The file has no data rows.');
        return;
      }
      const detectedHeaders = raw[0].map(String).filter((h) => h.trim() !== '');
      const detectedRows = raw
        .slice(1)
        .filter((r) => r.some((c) => String(c).trim() !== ''))
        .map((r) => Object.fromEntries(detectedHeaders.map((h, i) => [h, r[i] ?? ''])));
      setHeaders(detectedHeaders);
      setRows(detectedRows);
      setMapping(autoDetectMapping(detectedHeaders));
      setStep('map');
      setError('');
    } catch {
      setError('Could not read that file. Make sure it is a valid Excel/CSV file.');
    }
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processFileBuffer(reader.result);
    reader.readAsArrayBuffer(file);
  }

  async function handleImportSubmit() {
    const hasCurrencyColumn = Boolean(mapping.currency);
    const productsPayload = rows.map((row) => {
      const obj = {};
      for (const field of IMPORT_FIELDS) {
        const col = mapping[field.key];
        obj[field.key] = col ? row[col] : undefined;
      }
      if (!hasCurrencyColumn) obj.currency = defaultCurrency;
      return obj;
    });

    try {
      const res = await apiClient.post(`/api/stores/${storeId}/products/bulk-import`, {
        products: productsPayload,
        updateExisting,
      });
      setResult(res);
      setStep('result');
      onImported?.();
    } catch {
      setError('Import failed.');
    }
  }

  function exportToExcel() {
    const activeCols = EXPORT_COLUMNS.filter((c) => exportCols[c.key]);
    const data = products.map((p) => {
      const row = {};
      activeCols.forEach((c) => {
        row[c.header] = c.val(p);
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = activeCols.map((c) => ({ wch: c.wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `inventory-${dateStr}.xlsx`);
  }

  const canSubmitImport = Boolean(mapping.name) && Boolean(mapping.price);

  return (
    <Modal title="Import / Export products" onClose={onClose} width="max-w-2xl">
      <div className="flex gap-2 mb-4 border-b border-[var(--border)]">
        <button
          onClick={() => setTab('import')}
          className={`px-3 py-2 text-sm font-medium border-b-2 ${
            tab === 'import' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-slate-500'
          }`}
        >
          Import
        </button>
        <button
          onClick={() => setTab('export')}
          className={`px-3 py-2 text-sm font-medium border-b-2 ${
            tab === 'export' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-slate-500'
          }`}
        >
          Export
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {tab === 'import' && step === 'upload' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[var(--border)] rounded-xl p-10 text-center text-sm text-slate-500 cursor-pointer hover:border-[var(--accent)]"
        >
          Drop an Excel/CSV file here, or click to choose one.
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {tab === 'import' && step === 'map' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">{rows.length} rows found. Map columns below.</p>
          {IMPORT_FIELDS.map((field) => (
            <div key={field.key} className="flex items-center gap-3">
              <label className="w-32 text-sm text-slate-600">
                {field.label}
                {field.required && <span className="text-red-500">*</span>}
              </label>
              <select
                value={mapping[field.key] ?? ''}
                onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                className="flex-1 border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">— not mapped —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {!mapping.currency && (
            <div className="flex items-center gap-3">
              <label className="w-32 text-sm text-slate-600">Default currency</label>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                className="flex-1 border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="USD">USD</option>
                <option value="KHR">KHR</option>
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
            Update existing products matched by barcode
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setStep('upload')} className="text-sm px-3 py-1.5">
              Back
            </button>
            <button
              onClick={handleImportSubmit}
              disabled={!canSubmitImport}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
            >
              Import {rows.length} rows
            </button>
          </div>
        </div>
      )}

      {tab === 'import' && step === 'result' && result && (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">Import complete.</p>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>Imported: {result.imported}</li>
            <li>Updated: {result.updated}</li>
            <li>Skipped: {result.skipped}</li>
            <li>Errors: {result.errors}</li>
          </ul>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {tab === 'export' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Exports the {products.length} currently loaded products.</p>
          <div className="grid grid-cols-2 gap-2">
            {EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={exportCols[c.key]}
                  onChange={(e) => setExportCols({ ...exportCols, [c.key]: e.target.checked })}
                />
                {c.header}
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={exportToExcel}
              className="text-sm font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5"
            >
              Export to Excel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
