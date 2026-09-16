import React, { useState, useEffect, useRef } from "react";
import { useBackend } from "./BackendContext";
import * as XLSX from "xlsx";
import { ArrowLeft, X, Download, Upload, AlertTriangle, Package, Search, ChevronLeft, ChevronRight, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, Pencil, Trash, Save, Plus, CheckCircle2 } from 'lucide-react';
import { translations as t } from "./locales";

const PAGE_SIZE = 15;

const IMPORT_FIELDS = [
  { key: 'name',       labelKey: 'fieldName',      required: true  },
  { key: 'price',      labelKey: 'fieldPrice',     required: true  },
  { key: 'barcode',    labelKey: 'fieldBarcode',   required: false },
  { key: 'cost_price', labelKey: 'fieldCostPrice', required: false },
  { key: 'currency',   labelKey: 'fieldCurrency',  required: false },
  { key: 'stock',      labelKey: 'fieldStock',     required: false },
];

const IMPORT_HINTS = {
  name:       ['name', 'productname', 'itemname', 'description', 'product', 'item', 'title'],
  price:      ['price', 'retailprice', 'sellingprice', 'unitprice', 'saleprice', 'salesprice'],
  barcode:    ['barcode', 'sku', 'code', 'upc', 'ean', 'isbn', 'productcode'],
  cost_price: ['cost', 'costprice', 'purchaseprice', 'buyprice', 'wholesale', 'costofgoods'],
  currency:   ['currency', 'curr', 'unit'],
  stock:      ['stock', 'qty', 'quantity', 'instock', 'stockcount', 'inventory', 'available'],
};

function autoDetectMapping(headers) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapping = Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, '']));
  const used = new Set();
  for (const [field, hints] of Object.entries(IMPORT_HINTS)) {
    for (const hint of hints) {
      const match = headers.find(h => !used.has(h) && norm(h) === hint);
      if (match) { mapping[field] = match; used.add(match); break; }
    }
  }
  return mapping;
}

export default function StockManager({
  onBackToRegister,
  currentLocale,
  mainCurrency = "USD",
  dynamicRate = 4100,
}) {
  const BACKEND_URL = useBackend();
  const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);
  const [products, setProducts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    barcode: "",
    price: "",
    cost_price: "",
    currency: "USD",
    stock: "",
  });
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("id");
  const [sortDir, setSortDir] = useState("asc");
  const [currFilter, setCurrFilter] = useState("all");
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);

  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportScope, setExportScope] = useState("filtered");
  const [exportCols, setExportCols] = useState({
    id: true, name: true, barcode: true, currency: true,
    price: true, priceUsd: true, priceKhr: true, stock: true, lowStock: false,
  });
  const [newProduct, setNewProduct] = useState({
    name: "",
    barcode: "",
    price: "",
    cost_price: "",
    currency: mainCurrency,
    stock: "",
  });

  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState('upload'); // 'upload' | 'map' | 'result'
  const [importHeaders, setImportHeaders] = useState([]);
  const [importRows, setImportRows] = useState([]);
  const [importMapping, setImportMapping] = useState(Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, ''])));
  const [importUpdateExisting, setImportUpdateExisting] = useState(true);
  const [importDefaultCurrency, setImportDefaultCurrency] = useState(mainCurrency);
  const [importResult, setImportResult] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importDragOver, setImportDragOver] = useState(false);
  const importFileRef = useRef(null);

  useEffect(() => {
    setPage(1);
  }, [search, sortCol, sortDir, currFilter, lowStock]);


  const labels = t[currentLocale]?.stock || t["km"].stock;
  const il = labels.import;
  const el = labels.export;

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/products`);
      if (response.ok) {
        const data = await response.json();
        setProducts(data);
      }
    } catch (err) {
      console.error("Failed to grab product inventory mapping:", err);
    }
  };

  const handleEditClick = (product) => {
    setEditingId(product.id);
    setEditForm({
      name: product.name,
      barcode: product.barcode,
      price: product.price || "",
      cost_price: product.cost_price || "",
      currency: product.currency || "USD",
      stock: product.stock,
    });
  };

  const priceEquivalent = (form) => {
    const p = parseFloat(form.price);
    if (!p) return null;
    return form.currency === "USD"
      ? `≈ ${Math.round(p * dynamicRate).toLocaleString()} ៛`
      : `≈ $${(p / dynamicRate).toFixed(2)}`;
  };

  const handleSaveEdit = async (id) => {
    if (!editForm.name || !editForm.barcode || !editForm.price) {
      alert(labels.alertMandatory || "Please fill out all mandatory fields.");
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          barcode: editForm.barcode,
          price: parseFloat(editForm.price),
          cost_price: parseFloat(editForm.cost_price) || 0,
          currency: editForm.currency,
          stock: parseInt(editForm.stock, 10) || 0,
        }),
      });

      if (response.ok) {
        setEditingId(null);
        fetchInventory();
      } else {
        alert(labels.alertUpdateFail || "Failed to update product details.");
      }
    } catch (err) {
      console.error("Error modifying product asset rows:", err);
    }
  };

  const handleDeleteProduct = async (id) => {
    try {
      await fetch(`${BACKEND_URL}/api/products/${id}`, { method: 'DELETE' });
      setDeleteConfirmId(null);
      fetchInventory();
    } catch (err) {
      console.error('Error deleting product:', err);
    }
  };

  const handleAddProductSubmit = async (e) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.barcode || !newProduct.price) {
      alert(
        labels.alertMandatory ||
          "Please fill out all mandatory identity fields",
      );
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProduct.name,
          barcode: newProduct.barcode,
          price: parseFloat(newProduct.price),
          cost_price: parseFloat(newProduct.cost_price) || 0,
          currency: newProduct.currency,
          stock: parseInt(newProduct.stock, 10) || 0,
        }),
      });

      if (response.ok) {
        setNewProduct({
          name: "",
          barcode: "",
          price: "",
          cost_price: "",
          currency: mainCurrency,
          stock: "",
        });
        setShowAddForm(false);
        fetchInventory();
      } else {
        const errorData = await response.json();
        alert(
          `Error: ${errorData.error || "Failed to initialize database product card."}`,
        );
      }
    } catch (err) {
      console.error("Error adding product record:", err);
    }
  };

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  };
  const si = (col) => (
    <span className={`inline-flex items-center ml-1 ${sortCol === col ? "text-indigo-400" : "text-slate-300 dark:text-slate-600"}`}>
      {sortCol === col ? (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronsUpDown size={11} />}
    </span>
  );

  const q = search.trim().toLowerCase();
  const toUsd = (p) =>
    p.currency === "KHR"
      ? parseFloat(p.price) / dynamicRate
      : parseFloat(p.price);
  const displayed = [...products]
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q),
    )
    .filter((p) => currFilter === "all" || p.currency === currFilter)
    .filter((p) => !lowStock || p.stock <= 5)
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortCol) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "barcode":
          return dir * a.barcode.localeCompare(b.barcode);
        case "price":
          return dir * (toUsd(a) - toUsd(b));
        case "stock":
          return dir * (a.stock - b.stock);
        default:
          return dir * (a.id - b.id);
      }
    });

  const totalPages = Math.ceil(displayed.length / PAGE_SIZE);
  const pageNums = (() => {
    if (totalPages <= 7)
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = [1];
    if (page > 3) pages.push("...");
    for (
      let i = Math.max(2, page - 1);
      i <= Math.min(totalPages - 1, page + 1);
      i++
    )
      pages.push(i);
    if (page < totalPages - 2) pages.push("...");
    if (totalPages > 1) pages.push(totalPages);
    return pages;
  })();
  const paged = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const EXPORT_COL_DEFS = [
    { key: "id",       header: "ID",           labelKey: "colId",       wch: 6,  val: (p) => p.id },
    { key: "name",     header: "Name",          labelKey: "colName",     wch: 36, val: (p) => p.name },
    { key: "barcode",  header: "Barcode",       labelKey: "colBarcode",  wch: 16, val: (p) => p.barcode },
    { key: "currency", header: "Currency",      labelKey: "colCurrency", wch: 10, val: (p) => p.currency },
    { key: "price",    header: "Price",         labelKey: "colPrice",    wch: 12, val: (p) => parseFloat(p.price) },
    { key: "priceUsd", header: "Price (USD)",   labelKey: "colPriceUsd", wch: 12, val: (p) => p.currency === "KHR" ? parseFloat((parseFloat(p.price) / dynamicRate).toFixed(2)) : parseFloat(p.price) },
    { key: "priceKhr", header: "Price (KHR)",   labelKey: "colPriceKhr", wch: 14, val: (p) => p.currency === "KHR" ? parseFloat(p.price) : Math.round(parseFloat(p.price) * dynamicRate) },
    { key: "stock",    header: "Stock",         labelKey: "colStock",    wch: 8,  val: (p) => p.stock },
    { key: "lowStock", header: "Low Stock",     labelKey: "colLowStock", wch: 10, val: (p) => p.stock <= 5 ? "Yes" : "No" },
  ];

  const closeImport = () => {
    setShowImportModal(false);
    setImportStep('upload');
    setImportHeaders([]);
    setImportRows([]);
    setImportMapping(Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, ''])));
    setImportDefaultCurrency(mainCurrency);
    setImportResult(null);
    setImportLoading(false);
  };

  const processFileBuffer = (buffer) => {
    try {
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (raw.length < 2) { alert(il.alertNoRows); return; }
      const headers = raw[0].map(String).filter(h => h.trim() !== '');
      const rows = raw.slice(1)
        .filter(r => r.some(c => String(c).trim() !== ''))
        .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
      setImportHeaders(headers);
      setImportRows(rows);
      setImportMapping(autoDetectMapping(headers));
      setImportStep('map');
    } catch {
      alert(il.alertBadFile);
    }
  };

  const handleImportFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => processFileBuffer(e.target.result);
    reader.readAsArrayBuffer(file);
  };

  useEffect(() => {
    if (!IS_TAURI || !showImportModal || importStep !== 'upload') return;
    let unlisten;
    (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const { invoke } = await import('@tauri-apps/api/core');
      const webview = getCurrentWebview();
      unlisten = await webview.onDragDropEvent(async (event) => {
        const { type, paths } = event.payload;
        if (type === 'enter' || type === 'over') {
          setImportDragOver(true);
        } else if (type === 'leave') {
          setImportDragOver(false);
        } else if (type === 'drop' && paths?.length > 0) {
          setImportDragOver(false);
          try {
            const bytes = await invoke('read_file_bytes', { path: paths[0] });
            processFileBuffer(new Uint8Array(bytes));
          } catch (err) {
            alert(il.alertDropFailed + err);
          }
        }
      });
    })();
    return () => { unlisten?.(); };
  }, [IS_TAURI, showImportModal, importStep]);

  const handleImportSubmit = async () => {
    setImportLoading(true);
    try {
      const products = importRows.map(row => {
        const obj = Object.fromEntries(IMPORT_FIELDS.map(({ key }) => [key, importMapping[key] ? row[importMapping[key]] : '']));
        if (!obj.currency) obj.currency = importDefaultCurrency;
        return obj;
      });
      const res = await fetch(`${BACKEND_URL}/api/products/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products, updateExisting: importUpdateExisting }),
      });
      const result = await res.json();
      setImportResult(result);
      setImportStep('result');
      fetchInventory();
    } catch (err) {
      alert(il.alertImportFailed + err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const exportToExcel = () => {
    const source = exportScope === "all" ? products : displayed;
    const activeCols = EXPORT_COL_DEFS.filter((c) => exportCols[c.key]);

    const rows = source.map((p) => {
      const row = {};
      activeCols.forEach((c) => { row[c.header] = c.val(p); });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = activeCols.map((c) => ({ wch: c.wch }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `inventory-${dateStr}.xlsx`);
    setShowExportModal(false);
  };

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-900 flex flex-col font-sans text-slate-900 dark:text-white antialiased overflow-hidden">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3.5 flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-3.5">
          <button
            onClick={onBackToRegister}
            className="px-3.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent hover:border-slate-200 dark:hover:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
              {t[currentLocale]?.manageInventory || "Inventory Management"}
            </h1>
            <p className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 tracking-wider uppercase">
              {labels.inventoryLedger || "Inventory Stock Ledger"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-1 mx-6">
          <div className="relative flex-1 max-w-sm">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setEditingId(null);
              }}
              placeholder={labels.searchPlaceholder}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 dark:text-slate-100 border border-transparent dark:border-slate-700 focus:border-indigo-300 dark:focus:border-indigo-600 focus:bg-white dark:focus:bg-slate-800 rounded-xl outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => { setShowImportModal(true); setImportStep('upload'); }}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Download size={14} /> {il.btnLabel}
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            disabled={products.length === 0}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Upload size={14} /> {el.btnLabel}
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95"
          >
            <Plus size={14} />{labels.registerNew || "Register New Product"}
          </button>
        </div>
      </header>

      {/* Data Matrix Grid Table Wrapper */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Filter bar */}
        <div className="px-4 py-2.5 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-shrink-0">
          <div className="flex gap-1">
            {["all", "USD", "KHR"].map((c) => (
              <button
                key={c}
                onClick={() => setCurrFilter(c)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  currFilter === c
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                }`}
              >
                {c === "all" ? "All" : c}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <button
            onClick={() => setLowStock((v) => !v)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 ${
              lowStock
                ? "bg-amber-500 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            <AlertTriangle size={12} /> {labels.lowStock || "Low Stock"}
          </button>
          <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">
            {displayed.length} {labels.products || "products"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-500">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center text-slate-400 dark:text-slate-500">
                <Package size={28} />
              </div>
              <p className="text-sm font-semibold">
                {labels.noProducts || "No products yet"}
              </p>
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-500">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center text-slate-400 dark:text-slate-500">
                <Search size={28} />
              </div>
              <p className="text-sm font-semibold">
                {labels.noResults || "No matching products"}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-w-6xl mx-auto">
              {/* Column headers */}
              <div className="grid grid-cols-[44px_1fr_140px_120px_120px_90px_100px] gap-3 px-4 py-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                <button
                  className="text-left cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 select-none"
                  onClick={() => toggleSort("id")}
                >
                  ID{si("id")}
                </button>
                <button
                  className="text-left cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 select-none"
                  onClick={() => toggleSort("name")}
                >
                  {labels.thName || "Name"}
                  {si("name")}
                </button>
                <button
                  className="text-left cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 select-none"
                  onClick={() => toggleSort("barcode")}
                >
                  {labels.thBarcode || "Barcode"}
                  {si("barcode")}
                </button>
                <button
                  className="text-center cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 select-none"
                  onClick={() => toggleSort("price")}
                >
                  {labels.thPrice || "Price"}
                  {si("price")}
                </button>
                <span className="text-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {labels.costPrice || "Cost"}
                </span>
                <button
                  className="text-left cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 select-none truncate min-w-fit"
                  onClick={() => toggleSort("stock")}
                >
                  {labels.thStock || "Stock"}
                  {si("stock")}
                </button>
                <span />
              </div>

              {paged.map((product) => {
                const isEditing = editingId === product.id;
                const isLowStock = product.stock <= 5;

                return (
                  <div
                    key={product.id}
                    className={`bg-white dark:bg-slate-800 rounded-2xl border transition-all overflow-hidden ${
                      isEditing
                        ? "border-indigo-200 dark:border-indigo-800 shadow-sm"
                        : isLowStock
                          ? "border-amber-200/60 dark:border-amber-800/40 hover:border-amber-300 dark:hover:border-amber-700"
                          : "border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="grid grid-cols-[44px_1fr_140px_120px_120px_90px_100px] gap-3 px-4 py-3.5 items-center">
                      {/* ID */}
                      <span className="font-black text-sm text-indigo-600 dark:text-indigo-400">
                        #{String(product.id).padStart(3, "0")}
                      </span>

                      {/* Name */}
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) =>
                            setEditForm({ ...editForm, name: e.target.value })
                          }
                          className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 w-full text-sm font-semibold outline-none focus:border-indigo-300 dark:focus:border-indigo-600"
                        />
                      ) : (
                        <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {product.name}
                        </span>
                      )}

                      {/* Barcode */}
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.barcode}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              barcode: e.target.value,
                            })
                          }
                          className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 w-full text-xs outline-none focus:border-indigo-300 dark:focus:border-indigo-600"
                        />
                      ) : (
                        <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-bold truncate inline-block max-w-full">
                          {product.barcode}
                        </span>
                      )}

                      {/* Price */}
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step={editForm.currency === "USD" ? "0.01" : "100"}
                            value={editForm.price}
                            onChange={(e) =>
                              setEditForm({ ...editForm, price: e.target.value })
                            }
                            className="px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 min-w-0 flex-1 text-center font-semibold text-sm outline-none focus:border-indigo-300 dark:focus:border-indigo-600"
                          />
                          <select
                            value={editForm.currency}
                            onChange={(e) =>
                              setEditForm({ ...editForm, currency: e.target.value })
                            }
                            className="px-1.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 text-xs font-bold text-slate-600 dark:text-slate-300 outline-none focus:border-indigo-300 dark:focus:border-indigo-600"
                          >
                            <option value="USD">USD</option>
                            <option value="KHR">KHR</option>
                          </select>
                        </div>
                      ) : (
                        <div className="text-center">
                          <p className="text-sm font-black text-slate-900 dark:text-white">
                            {product.currency === "KHR"
                              ? `${parseFloat(product.price).toLocaleString()} ៛`
                              : `$${parseFloat(product.price).toFixed(2)}`}
                          </p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {product.currency === "KHR"
                              ? `≈ $${(parseFloat(product.price) / dynamicRate).toFixed(2)}`
                              : `≈ ${Math.round(parseFloat(product.price) * dynamicRate).toLocaleString()} ៛`}
                          </p>
                        </div>
                      )}

                      {/* Cost Price */}
                      {isEditing ? (
                        <input
                          type="number"
                          step={editForm.currency === "USD" ? "0.01" : "100"}
                          placeholder="0"
                          value={editForm.cost_price}
                          onChange={(e) =>
                            setEditForm({ ...editForm, cost_price: e.target.value })
                          }
                          className="px-2 py-1.5 border border-amber-200 dark:border-amber-800 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 dark:text-slate-100 w-full text-center text-sm font-semibold outline-none focus:border-amber-400 dark:focus:border-amber-600"
                        />
                      ) : (
                        <div className="text-center">
                          {parseFloat(product.cost_price) > 0 ? (
                            <>
                              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
                                {product.currency === "KHR"
                                  ? `${parseFloat(product.cost_price).toLocaleString()} ៛`
                                  : `$${parseFloat(product.cost_price).toFixed(2)}`}
                              </p>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                                {product.currency === "KHR"
                                  ? `≈ $${(parseFloat(product.cost_price) / dynamicRate).toFixed(2)}`
                                  : `≈ ${Math.round(parseFloat(product.cost_price) * dynamicRate).toLocaleString()} ៛`}
                              </p>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </div>
                      )}

                      {/* Stock */}
                      {isEditing ? (
                        <input
                          type="number"
                          value={editForm.stock}
                          onChange={(e) =>
                            setEditForm({ ...editForm, stock: e.target.value })
                          }
                          className="px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 w-16 text-center font-bold text-sm outline-none focus:border-indigo-300 dark:focus:border-indigo-600"
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold ${isLowStock ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800" : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"}`}
                          >
                            {product.stock}
                          </span>
                          {isLowStock && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                              {labels.needsRestock}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      {isEditing ? (
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleSaveEdit(product.id)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors truncate"
                          >
                            <Save size={12}/>
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 rounded-lg text-xs font-bold cursor-pointer transition-colors truncate"
                          >
                            <X size={12}/>
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleEditClick(product)}
                            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-200 text-xs font-bold bg-indigo-50/60 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 px-3 py-1.5 rounded-lg transition-colors cursor-pointer truncate"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(product.id)}
                            className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs font-bold bg-red-50/60 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 px-3 py-1.5 rounded-lg transition-colors cursor-pointer truncate"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination footer — always visible at the bottom */}
      {totalPages > 1 && (
        <div className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
            {(page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, displayed.length)} of {displayed.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            {pageNums.map((n, i) =>
              n === "..." ? (
                <span key={`e${i}`} className="px-1 text-slate-300 dark:text-slate-600 text-xs">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${page === n ? "bg-indigo-600 text-white" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"}`}
                >
                  {n}
                </button>
              ),
            )}
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === totalPages}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Hidden file input for import */}
      <input
        ref={importFileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={e => { handleImportFile(e.target.files[0]); e.target.value = ''; }}
      />

      {/* IMPORT FROM EXCEL MODAL */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl w-full max-w-xl flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700/50">
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                  {importStep === 'upload' ? il.titleUpload : importStep === 'map' ? il.titleMap : il.titleResult}
                </h3>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {importStep === 'upload' && il.subtitleUpload}
                  {importStep === 'map' && `${importRows.length} ${il.subtitleMap}`}
                  {importStep === 'result' && il.subtitleResult}
                </p>
              </div>
              <button
                onClick={closeImport}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              ><X size={14} /></button>
            </div>

            {/* Step 1: Upload */}
            {importStep === 'upload' && (
              <>
                <div className="px-5 py-6">
                  <div
                    onDragOver={!IS_TAURI ? e => { e.preventDefault(); setImportDragOver(true); } : undefined}
                    onDragLeave={!IS_TAURI ? () => setImportDragOver(false) : undefined}
                    onDrop={!IS_TAURI ? e => { e.preventDefault(); setImportDragOver(false); handleImportFile(e.dataTransfer.files[0]); } : undefined}
                    onClick={() => importFileRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                      importDragOver
                        ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30'
                        : 'border-slate-200 dark:border-slate-600 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-slate-50 dark:hover:bg-slate-700/30'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center">
                      <Upload size={22} className="text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{il.dropZoneTitle}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{il.dropZoneHint}</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900 flex justify-end">
                  <button onClick={closeImport} className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs cursor-pointer transition-colors">
                    {il.cancelBtn}
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Map columns */}
            {importStep === 'map' && (
              <>
                <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[60vh]">
                  {/* Mapping grid */}
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{il.sectionMapping}</p>
                    <div className="space-y-2">
                      {IMPORT_FIELDS.map(({ key, labelKey, required }) => (
                        <div key={key} className="flex items-center gap-3">
                          <div className="w-28 flex-shrink-0 flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{il[labelKey]}</span>
                            {required && <span className="text-[10px] font-black text-red-400">*</span>}
                          </div>
                          <select
                            value={importMapping[key]}
                            onChange={e => setImportMapping(prev => ({ ...prev, [key]: e.target.value }))}
                            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-xl border outline-none transition-all bg-white dark:bg-slate-900 dark:text-slate-100 ${
                              required && !importMapping[key]
                                ? 'border-red-300 dark:border-red-700 focus:border-red-400'
                                : importMapping[key]
                                  ? 'border-violet-300 dark:border-violet-700 focus:border-violet-400 bg-violet-50/50 dark:bg-violet-950/20'
                                  : 'border-slate-200 dark:border-slate-700 focus:border-slate-300 dark:focus:border-slate-600'
                            }`}
                          >
                            <option value="">{il.skipOption}</option>
                            {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>

                    {/* Default currency fallback — shown only when currency column is not mapped */}
                    {!importMapping.currency && (
                      <div className="flex items-center gap-3 px-3 py-2.5 mt-2 rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
                        <AlertTriangle size={14} className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-300 flex-1">
                          {il.noCurrencyColHint || "No currency column — set a default:"}
                        </span>
                        <select
                          value={importDefaultCurrency}
                          onChange={e => setImportDefaultCurrency(e.target.value)}
                          className="px-2.5 py-1.5 text-xs font-bold rounded-xl border border-amber-300 dark:border-amber-600 bg-white dark:bg-slate-900 dark:text-slate-100 outline-none focus:border-amber-400"
                        >
                          <option value="USD">USD</option>
                          <option value="KHR">KHR</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Preview */}
                  {importRows.length > 0 && IMPORT_FIELDS.some(f => importMapping[f.key]) && (
                    <div>
                      <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{il.sectionPreview}</p>
                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-900">
                              {IMPORT_FIELDS.filter(f => importMapping[f.key]).map(f => (
                                <th key={f.key} className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">{il[f.labelKey]}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {importRows.slice(0, 3).map((row, i) => (
                              <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                                {IMPORT_FIELDS.filter(f => importMapping[f.key]).map(f => (
                                  <td key={f.key} className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[140px] truncate">
                                    {String(row[importMapping[f.key]] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Update toggle */}
                  <label className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${importUpdateExisting ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                    <input
                      type="checkbox"
                      checked={importUpdateExisting}
                      onChange={e => setImportUpdateExisting(e.target.checked)}
                      className="accent-violet-600"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{il.updateExistingLabel}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">{il.updateExistingHint}</p>
                    </div>
                  </label>
                </div>

                <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900 flex items-center justify-between flex-shrink-0">
                  <button
                    onClick={() => setImportStep('upload')}
                    className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs cursor-pointer transition-colors"
                  >{il.backBtn}</button>
                  <div className="flex gap-2">
                    <button onClick={closeImport} className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs cursor-pointer transition-colors">
                      {il.cancelBtn}
                    </button>
                    <button
                      onClick={handleImportSubmit}
                      disabled={importLoading || !importMapping.name || !importMapping.price}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 dark:disabled:bg-slate-600 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      {importLoading ? il.importingBtn : `${il.importBtn} ${importRows.length} ${il.rowsSuffix}`}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Step 3: Result */}
            {importStep === 'result' && importResult && (
              <>
                <div className="px-5 py-6 space-y-3">
                  <div className="flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-black text-emerald-700 dark:text-emerald-300">{importResult.imported} {il.inserted}</p>
                    </div>
                  </div>
                  {importResult.updated > 0 && (
                    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
                      <Upload size={18} className="text-violet-600 dark:text-violet-400 flex-shrink-0" />
                      <p className="text-xs font-black text-violet-700 dark:text-violet-300">{importResult.updated} {il.updated}</p>
                    </div>
                  )}
                  {(importResult.skipped > 0 || importResult.errors > 0) && (
                    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
                      <p className="text-xs font-black text-amber-700 dark:text-amber-300">
                        {importResult.skipped + importResult.errors} {il.skipped}
                      </p>
                    </div>
                  )}
                </div>
                <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900 flex justify-end">
                  <button
                    onClick={closeImport}
                    className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl text-xs cursor-pointer transition-colors"
                  >{il.doneBtn}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* EXPORT TO EXCEL MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl w-full max-w-sm flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700/50">
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">{el.title}</h3>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{el.subtitle}</p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              ><X size={14} /></button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {/* Data scope */}
              <div>
                <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{el.sectionData}</p>
                <div className="space-y-1.5">
                  {[
                    { value: "filtered", label: el.scopeCurrentView, count: displayed.length },
                    { value: "all",      label: el.scopeAllProducts, count: products.length },
                  ].map(({ value, label, count }) => (
                    <label key={value} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${exportScope === value ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"}`}>
                      <input
                        type="radio"
                        name="exportScope"
                        value={value}
                        checked={exportScope === value}
                        onChange={() => setExportScope(value)}
                        className="accent-indigo-600"
                      />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1">{label}</span>
                      <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">{count} {el.rowsSuffix}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Column selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{el.sectionColumns}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setExportCols(Object.fromEntries(EXPORT_COL_DEFS.map(c => [c.key, true])))} className="text-[11px] font-bold text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer">{el.selectAll}</button>
                    <span className="text-slate-200 dark:text-slate-600">|</span>
                    <button onClick={() => setExportCols(Object.fromEntries(EXPORT_COL_DEFS.map(c => [c.key, false])))} className="text-[11px] font-bold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">{el.selectNone}</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {EXPORT_COL_DEFS.map(({ key, labelKey }) => (
                    <label key={key} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all ${exportCols[key] ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"}`}>
                      <input
                        type="checkbox"
                        checked={exportCols[key]}
                        onChange={() => setExportCols(prev => ({ ...prev, [key]: !prev[key] }))}
                        className="accent-indigo-600"
                      />
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{el[labelKey]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {Object.values(exportCols).filter(Boolean).length} {el.colsSuffix} · {exportScope === "all" ? products.length : displayed.length} {el.rowsSuffix}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl text-xs cursor-pointer transition-colors"
                >
                  {el.cancelBtn}
                </button>
                <button
                  onClick={exportToExcel}
                  disabled={Object.values(exportCols).every(v => !v)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 dark:disabled:bg-slate-600 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs cursor-pointer transition-colors"
                >
                  <Download size={14} /> {el.exportBtn}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL POPUP DIALOG: REGISTER NEW PRODUCT */}
      {showAddForm && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-xl max-w-md w-full overflow-hidden flex flex-col space-y-4 transform scale-100 transition-all">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 pb-3">
              <h3 className="text-base font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider font-display">
                {labels.registerNew || "Register New Product"}
              </h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 font-bold text-sm p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg cursor-pointer transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleAddProductSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide font-display">
                  {labels.itemName || "Item Name"}
                </label>
                <input
                  type="text"
                  required
                  placeholder={labels.placeholderItemName || "e.g. Baby Wipes"}
                  value={newProduct.name}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, name: e.target.value })
                  }
                  className="w-full mt-1.5 p-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-sm font-medium focus:outline-none focus:border-indigo-500 font-display"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide font-display">
                  {labels.barcodeString || "Barcode String"}
                </label>
                <input
                  type="text"
                  required
                  placeholder={labels.placeholderBarcode || "Scan or type code"}
                  value={newProduct.barcode}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, barcode: e.target.value })
                  }
                  className="w-full mt-1.5 p-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide font-display">
                  {labels.retailPrice || "Price"}
                </label>
                <div className="flex gap-2 mt-1.5">
                  <select
                    value={newProduct.currency}
                    onChange={(e) =>
                      setNewProduct({
                        ...newProduct,
                        currency: e.target.value,
                        price: "",
                      })
                    }
                    className="p-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="USD">USD</option>
                    <option value="KHR">KHR</option>
                  </select>
                  <input
                    type="number"
                    step={newProduct.currency === "USD" ? "0.01" : "100"}
                    placeholder={newProduct.currency === "USD" ? "0.00" : "0"}
                    value={newProduct.price}
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, price: e.target.value })
                    }
                    className="flex-1 p-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-sm font-bold text-indigo-600 dark:text-indigo-400 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {newProduct.price && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    {priceEquivalent(newProduct)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide font-display">
                  {labels.costPrice || "Cost Price"}
                </label>
                <input
                  type="number"
                  step={newProduct.currency === "USD" ? "0.01" : "100"}
                  placeholder={newProduct.currency === "USD" ? "0.00" : "0"}
                  value={newProduct.cost_price}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, cost_price: e.target.value })
                  }
                  className="w-full mt-1.5 p-2.5 border border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 dark:text-slate-100 rounded-lg text-sm font-bold text-amber-700 dark:text-amber-400 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide font-display">
                  {labels.initialStock || "Initial Stock Count"}
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={newProduct.stock}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, stock: e.target.value })
                  }
                  className="w-full mt-1.5 p-2.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-sm font-bold text-indigo-600 dark:text-indigo-400 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2 justify-end border-t border-slate-100 dark:border-slate-700/50">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  {labels.cancelBtn || "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider shadow-xs transition-colors font-display cursor-pointer"
                >
                  {labels.saveToDb || "Save Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product delete confirmation modal */}
      {deleteConfirmId !== null && (() => {
        const product = products.find(p => p.id === deleteConfirmId);
        return (
          <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-red-200 dark:border-red-800 shadow-xl max-w-sm w-full p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Trash2 size={24} className="text-red-500 dark:text-red-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  {labels.deleteWarningTitle || 'Remove Product?'}
                </h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                <span className="font-bold text-slate-800 dark:text-slate-100">{product?.name}</span>
                {' '}{labels.deleteWarningBody || 'will be hidden from the register and stock list. Past sales records are unaffected.'}
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {labels.cancelBtn || 'Cancel'}
                </button>
                <button
                  onClick={() => handleDeleteProduct(deleteConfirmId)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {labels.deleteConfirmBtn || 'Yes, Remove'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
