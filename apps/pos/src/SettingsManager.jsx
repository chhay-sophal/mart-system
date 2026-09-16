import React, { useState, useEffect } from 'react';
import { useBackend } from './BackendContext';
import { ArrowLeft, Store, Globe, ArrowLeftRight, Wallet, Smartphone, Banknote, CheckCircle2, AlertTriangle, AlertOctagon, HardDrive, RotateCcw, Download, FolderOpen, X, RefreshCw, Info } from 'lucide-react';
import { translations as t } from './locales';

export default function SettingsManager({ onBackToRegister, currentLocale, onLocaleChange, mainCurrency, onCurrencyChange }) {
  const BACKEND_URL = useBackend();
  const DEFAULT_SETTINGS = {
    store_name: '',
    store_icon: '',
    store_address: '',
    store_phone: '',
    exchange_rate: '4100',
    bakong_account_id: '',
    bakong_merchant_name: '',
    bakong_merchant_city: '',
    locale: 'km',
    main_currency: 'USD'
  };

  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [initialSettings, setInitialSettings] = useState({ ...DEFAULT_SETTINGS });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showConfirmPopup, setShowConfirmPopup] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [updateCheck, setUpdateCheck] = useState('idle'); // idle | checking | available | uptodate | error
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [activeSection, setActiveSection] = useState('store');

  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [exportingFile, setExportingFile] = useState(null);
  const [exportedFile, setExportedFile] = useState(null);
  const [cloudFolder, setCloudFolder] = useState('');
  const [cloudFolderSaving, setCloudFolderSaving] = useState(false);

  const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);

  useEffect(() => {
    fetchSettings();
    fetchBackups();
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => {});
  }, [IS_TAURI]);

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings(prev => ({ ...prev, ...data }));
        setInitialSettings(data);
        setCloudFolder(data.cloud_backup_folder || '');
      }
    } catch (err) {
      console.error('Failed to load store settings:', err);
    }
  };

  const fetchBackups = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/backup/list`);
      if (res.ok) setBackups(await res.json());
    } catch {}
  };

  const handleBackupNow = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/backup/now`, { method: 'POST' });
      if (res.ok) {
        setBackupSuccess(true);
        setTimeout(() => setBackupSuccess(false), 3000);
        fetchBackups();
      }
    } catch {}
    setBackupLoading(false);
  };

  const handleConfirmRestore = async () => {
    if (!restoreConfirm) return;
    setRestoreLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: restoreConfirm }),
      });
      if (res.ok) {
        setRestoreConfirm(null);
        setRestoreSuccess(true);
      }
    } catch {}
    setRestoreLoading(false);
  };

  const handleExport = async (filename) => {
    if (!IS_TAURI) return;
    setExportingFile(filename);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const destPath = await save({
        defaultPath: filename,
        filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
      });
      if (!destPath) { setExportingFile(null); return; }
      const res = await fetch(`${BACKEND_URL}/api/backup/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, destPath }),
      });
      if (res.ok) {
        setExportedFile(filename);
        setTimeout(() => setExportedFile(null), 3000);
      } else {
        const err = await res.json();
        alert(err.error || 'Export failed');
      }
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
    setExportingFile(null);
  };

  const saveCloudFolder = async (folder) => {
    setCloudFolderSaving(true);
    try {
      await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloud_backup_folder: folder }),
      });
      setCloudFolder(folder);
    } catch {}
    setCloudFolderSaving(false);
  };

  const handlePickCloudFolder = async () => {
    if (!IS_TAURI) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: 'Choose cloud backup folder' });
      if (selected) await saveCloudFolder(selected);
    } catch {}
  };

  const handleClearCloudFolder = async () => {
    await saveCloudFolder('');
  };

  const formatBackupName = (filename) => {
    const m = filename.match(/database-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.sqlite/);
    if (!m) return filename;
    const [, y, mo, d, h, min] = m;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(mo, 10) - 1]} ${parseInt(d, 10)}, ${y} · ${h}:${min}`;
  };

  const handleSubmitTrigger = (e) => {
    e.preventDefault();
    setShowConfirmPopup(true);
  };

  const handleConfirmSave = async () => {
    setShowConfirmPopup(false);
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        onLocaleChange(settings.locale);
        onCurrencyChange(settings.main_currency);
        setInitialSettings(settings);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        alert(t[currentLocale]?.settingsPage?.failSave || 'Failed to save settings.');
      }
    } catch (err) {
      console.error('Error pushing updated options:', err);
    }
  };

  // General dirty form change tracker — use ?? '' so keys missing from the API
  // response (e.g. store_name before first save) don't cause a permanent dirty state.
  const hasChanges = Object.keys(settings).some(
    key => String(settings[key] ?? '') !== String(initialSettings[key] ?? '')
  );

  // Evaluation conditions for core financial changes
  const isCurrencyChanged = initialSettings && String(settings.main_currency) !== String(initialSettings.main_currency);
  const isExchangeRateChanged = initialSettings && String(settings.exchange_rate) !== String(initialSettings.exchange_rate);

  // Everything under KHQR is evaluated as a critical parameter
  const isBakongAccountIdChanged = initialSettings && String(settings.bakong_account_id) !== String(initialSettings.bakong_account_id);
  const isBakongMerchantNameChanged = initialSettings && String(settings.bakong_merchant_name) !== String(initialSettings.bakong_merchant_name);
  const isBakongMerchantCityChanged = initialSettings && String(settings.bakong_merchant_city) !== String(initialSettings.bakong_merchant_city);

  const hasKhqrChanges = isBakongAccountIdChanged || isBakongMerchantNameChanged || isBakongMerchantCityChanged;
  const hasCriticalChanges = isCurrencyChanged || isExchangeRateChanged || hasKhqrChanges;

  const currentTranslations = t[currentLocale] || {};
  const s = currentTranslations.settingsPage || {};

  const handleCheckUpdate = async () => {
    if (!IS_TAURI || updateCheck === 'checking' || updateCheck === 'downloading') return;
    setUpdateCheck('checking');
    setPendingUpdate(null);
    setUpdateProgress(0);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) { setUpdateCheck('uptodate'); return; }
      setPendingUpdate(update);
      setUpdateCheck('available');
    } catch {
      setUpdateCheck('error');
    }
  };

  const handleInstallUpdate = async () => {
    if (!pendingUpdate) return;
    setUpdateCheck('downloading');
    setUpdateProgress(0);
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      let downloaded = 0;
      let total = 0;
      await pendingUpdate.downloadAndInstall(async (event) => {
        if (event.event === 'Started') { total = event.data.contentLength ?? 0; }
        else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (total > 0) setUpdateProgress(Math.round((downloaded / total) * 100));
        } else if (event.event === 'Finished') {
          setUpdateProgress(100);
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('kill_backend');
          } catch (_) {}
        }
      });
      await relaunch();
    } catch {
      setUpdateCheck('error');
    }
  };

  const navItems = [
    { id: 'store',    icon: Store,     label: s.storeProfileHeader || 'Store' },
    { id: 'payments', icon: Wallet,    label: s.currencyHeader || 'Payments', badge: isCurrencyChanged || isExchangeRateChanged },
    { id: 'khqr',     icon: Smartphone,label: s.bakongHeader || 'KHQR',       badge: hasKhqrChanges },
    { id: 'backup',   icon: HardDrive, label: s.backupSection?.header || 'Backup' },
    { id: 'about',    icon: Info,      label: 'About' },
  ];

  const CriticalBadge = () => (
    <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded-md uppercase tracking-wide animate-pulse">
      <AlertTriangle size={9} />{s.criticalBadge || 'Critical'}
    </span>
  );

  const inputBase = 'w-full px-3 py-2.5 border rounded-xl text-sm font-medium bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all';
  const inputNormal = `${inputBase} border-slate-200 dark:border-slate-700`;
  const inputCritical = `${inputBase} border-amber-300 dark:border-amber-700`;

  return (
    <div className="h-screen bg-slate-100 dark:bg-slate-950 flex flex-col overflow-hidden font-sans antialiased">

      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBackToRegister}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-bold text-slate-900 dark:text-white">{currentTranslations.settings || 'Settings'}</h1>
      </header>

      {/* Two-panel body */}
      <div className="flex-1 flex overflow-hidden">
        <form onSubmit={handleSubmitTrigger} className="flex-1 flex overflow-hidden">

          {/* Sidebar */}
          <nav className="w-48 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-2 gap-0.5 flex-shrink-0">
            {navItems.map(({ id, icon: Icon, label, badge }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  activeSection === id
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon size={14} className="flex-shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                {badge && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
              </button>
            ))}
          </nav>

          {/* Content panel */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-lg space-y-5">

                {/* ── STORE ── */}
                {activeSection === 'store' && <>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">{s.storeProfileHeader || 'Store Profile'}</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                      <div className="flex gap-4 items-start">
                        <div className="flex flex-col items-center gap-2 flex-shrink-0">
                          <div className="w-14 h-14 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center bg-slate-50 dark:bg-slate-900 overflow-hidden">
                            {settings.store_icon
                              ? <img src={settings.store_icon} alt="store icon" className="w-full h-full object-cover" />
                              : <Store size={20} className="text-slate-300 dark:text-slate-600" />}
                          </div>
                          <label className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline">
                            {s.uploadIcon || 'Upload'}
                            <input type="file" accept="image/*" className="hidden"
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = (ev) => setSettings({ ...settings, store_icon: ev.target.result });
                                reader.readAsDataURL(file);
                              }} />
                          </label>
                          {settings.store_icon && (
                            <button type="button" onClick={() => setSettings({ ...settings, store_icon: '' })}
                              className="text-[10px] text-slate-400 hover:text-red-500 transition-colors cursor-pointer">
                              {s.removeIcon || 'Remove'}
                            </button>
                          )}
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storeNameLabel || 'Store Name'}</label>
                          <input type="text" value={settings.store_name}
                            onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                            className={inputNormal} placeholder={s.storeNamePlaceholder || 'My Store'} />
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{s.storeNameHelp || 'Shown in the top-left corner of the register.'}</p>
                        </div>
                      </div>
                      <div className="mt-4">
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storeAddressLabel || 'Store Address'}</label>
                        <input type="text" value={settings.store_address}
                          onChange={(e) => setSettings({ ...settings, store_address: e.target.value })}
                          className={inputNormal} placeholder={s.storeAddressPlaceholder || 'Village, Commune, District, Province'} />
                      </div>
                      <div className="mt-4">
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storePhoneLabel || 'Phone Number'}</label>
                        <input type="text" value={settings.store_phone}
                          onChange={(e) => setSettings({ ...settings, store_phone: e.target.value })}
                          className={inputNormal} placeholder={s.storePhonePlaceholder || '012 345 678'} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">{s.languageHeader || 'Language'}</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">{s.terminalLang || 'Terminal Display Language'}</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[{ val: 'km', label: '🇰🇭 ភាសាខ្មែរ' }, { val: 'en', label: '🇺🇸 English' }].map(({ val, label }) => (
                          <button key={val} type="button" onClick={() => setSettings({ ...settings, locale: val })}
                            className={`py-2.5 px-4 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${settings.locale === val ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>}

                {/* ── PAYMENTS ── */}
                {activeSection === 'payments' && <>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{s.currencyHeader || 'Currency'}</p>
                      {isCurrencyChanged && <CriticalBadge />}
                    </div>
                    <div className={`bg-white dark:bg-slate-800 rounded-2xl border p-5 transition-all ${isCurrencyChanged ? 'border-amber-300 dark:border-amber-700 ring-2 ring-amber-100 dark:ring-amber-900/30' : 'border-slate-200 dark:border-slate-700'}`}>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">{s.selectPrimaryCurr || 'Primary Transactional Currency'}</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[{ val: 'USD', label: currentTranslations.mainCurrencyUsd || 'US Dollar (USD)' }, { val: 'KHR', label: currentTranslations.mainCurrencyKhr || 'Khmer Riel (KHR)' }].map(({ val, label }) => (
                          <button key={val} type="button" onClick={() => setSettings({ ...settings, main_currency: val })}
                            className={`py-2.5 px-4 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${settings.main_currency === val ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{s.financialsHeader || 'Exchange Rate'}</p>
                      {isExchangeRateChanged && <CriticalBadge />}
                    </div>
                    <div className={`bg-white dark:bg-slate-800 rounded-2xl border p-5 transition-all ${isExchangeRateChanged ? 'border-amber-300 dark:border-amber-700 ring-2 ring-amber-100 dark:ring-amber-900/30' : 'border-slate-200 dark:border-slate-700'}`}>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{currentTranslations.exchangeRate || 'Exchange Rate'} (1 USD = ? KHR)</label>
                      <input type="number" value={settings.exchange_rate}
                        onChange={(e) => setSettings({ ...settings, exchange_rate: e.target.value })}
                        className={isExchangeRateChanged ? inputCritical : inputNormal} placeholder="4100" />
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{s.exchangeRateHelp || 'Used to automatically calculate Riel checkout conversions.'}</p>
                    </div>
                  </div>
                </>}

                {/* ── KHQR ── */}
                {activeSection === 'khqr' && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{s.bakongHeader || 'KHQR Profile'}</p>
                      {hasKhqrChanges && <CriticalBadge />}
                    </div>
                    <div className={`bg-white dark:bg-slate-800 rounded-2xl border p-5 space-y-4 transition-all ${hasKhqrChanges ? 'border-amber-300 dark:border-amber-700 ring-2 ring-amber-100 dark:ring-amber-900/30' : 'border-slate-200 dark:border-slate-700'}`}>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.bakongAccountId || 'Bakong Account ID'}</label>
                        <input type="text" value={settings.bakong_account_id}
                          onChange={(e) => setSettings({ ...settings, bakong_account_id: e.target.value })}
                          className={`${isBakongAccountIdChanged ? inputCritical : inputNormal} font-mono text-indigo-600 dark:text-indigo-400`}
                          placeholder="store_account@abaa" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.shopNameLabel || 'Merchant Name'}</label>
                          <input type="text" value={settings.bakong_merchant_name}
                            onChange={(e) => setSettings({ ...settings, bakong_merchant_name: e.target.value })}
                            className={isBakongMerchantNameChanged ? inputCritical : inputNormal} placeholder="Baby Mart" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storeCityLabel || 'City'}</label>
                          <input type="text" value={settings.bakong_merchant_city}
                            onChange={(e) => setSettings({ ...settings, bakong_merchant_city: e.target.value })}
                            className={isBakongMerchantCityChanged ? inputCritical : inputNormal} placeholder="Phnom Penh" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── BACKUP ── */}
                {activeSection === 'backup' && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{s.backupSection?.header || 'Data Backup'}</p>
                      <button type="button" onClick={handleBackupNow} disabled={backupLoading}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer">
                        <HardDrive size={12} />
                        {backupLoading ? '...' : (s.backupSection?.backupNow || 'Backup Now')}
                      </button>
                    </div>

                    {backupSuccess && (
                      <div className="mb-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-2">
                        <CheckCircle2 size={13} />{s.backupSection?.backupSuccess || 'Backup created successfully!'}
                      </div>
                    )}

                    {IS_TAURI && (
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                            <FolderOpen size={13} />{s.backupSection?.cloudFolderLabel || 'Cloud Sync Folder'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {cloudFolder && (
                              <button type="button" onClick={handleClearCloudFolder} disabled={cloudFolderSaving}
                                className="p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50">
                                <X size={12} />
                              </button>
                            )}
                            <button type="button" onClick={handlePickCloudFolder} disabled={cloudFolderSaving}
                              className="px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-slate-500 rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50">
                              <FolderOpen size={10} />
                              {cloudFolderSaving ? '...' : (s.backupSection?.chooseFolder || 'Choose Folder')}
                            </button>
                          </div>
                        </div>
                        {cloudFolder
                          ? <p className="mt-2 text-[11px] text-indigo-600 dark:text-indigo-400 font-mono break-all">{cloudFolder}</p>
                          : <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">{s.backupSection?.cloudFolderHint || 'Not set. Point to your OneDrive, Google Drive, or Dropbox folder to auto-sync backups.'}</p>}
                      </div>
                    )}

                    {restoreSuccess ? (
                      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-400 font-semibold flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5"><CheckCircle2 size={13} />{s.backupSection?.restoreSuccess || 'Database restored! Please reload the app.'}</span>
                        <button type="button" onClick={() => window.location.reload()}
                          className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold cursor-pointer whitespace-nowrap">
                          {s.backupSection?.reloadBtn || 'Reload App'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {backups.length === 0 ? (
                          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-8">
                            {s.backupSection?.noBackups || 'No backups yet. A backup is created automatically each time the app starts.'}
                          </p>
                        ) : backups.map(b => (
                          <div key={b.name} className="flex items-center justify-between py-2.5 px-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                            <div>
                              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{formatBackupName(b.name)}</p>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{(b.size / 1024).toFixed(1)} KB</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {IS_TAURI && (
                                <button type="button" onClick={() => handleExport(b.name)} disabled={exportingFile === b.name}
                                  className={`px-2.5 py-1 border rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 ${exportedFile === b.name ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-slate-500'}`}>
                                  {exportedFile === b.name ? <><CheckCircle2 size={10} />{s.backupSection?.exportDone || 'Saved!'}</> : exportingFile === b.name ? '...' : <><Download size={10} />{s.backupSection?.export || 'Export'}</>}
                                </button>
                              )}
                              <button type="button" onClick={() => setRestoreConfirm(b.name)}
                                className="px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400 text-slate-500 rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer">
                                <RotateCcw size={10} />{s.backupSection?.restore || 'Restore'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── ABOUT ── */}
                {activeSection === 'about' && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">About</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                      <div className="p-5 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
                          <Store size={18} className="text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">SOSO POS</p>
                          {appVersion && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Version {appVersion}</p>}
                        </div>
                      </div>

                      {IS_TAURI && (
                        <div className="p-5 space-y-3">
                          {updateCheck !== 'downloading' && (
                            <button type="button" onClick={handleCheckUpdate} disabled={updateCheck === 'checking'}
                              className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50 cursor-pointer">
                              <RefreshCw size={13} className={updateCheck === 'checking' ? 'animate-spin' : ''} />
                              {updateCheck === 'checking' ? 'Checking...' : updateCheck === 'uptodate' ? "You're up to date" : updateCheck === 'error' ? 'Check failed — try again' : 'Check for updates'}
                            </button>
                          )}
                          {updateCheck === 'available' && pendingUpdate && (
                            <div className="flex items-center gap-3 pt-1">
                              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold">v{pendingUpdate.version} available</span>
                              <button type="button" onClick={handleInstallUpdate}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer">
                                Install & Restart
                              </button>
                            </div>
                          )}
                          {updateCheck === 'downloading' && (
                            <div className="space-y-2">
                              <p className="text-xs text-slate-500 dark:text-slate-400">{updateProgress > 0 ? `Downloading ${updateProgress}%` : 'Downloading...'}</p>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                                <div className="h-1.5 rounded-full bg-indigo-600 transition-all"
                                  style={{ width: updateProgress > 0 ? `${updateProgress}%` : '30%' }} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Save footer */}
            {(hasChanges || saveSuccess) && (
              <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-3.5 flex items-center justify-between flex-shrink-0">
                {saveSuccess
                  ? <span className="text-emerald-600 dark:text-emerald-400 text-sm font-semibold flex items-center gap-1.5"><CheckCircle2 size={15} />{s.saveSuccess || 'Changes saved!'}</span>
                  : <div />}
                {hasChanges && (
                  <button type="submit"
                    className={`px-5 py-2 font-bold rounded-xl text-sm transition-colors cursor-pointer ${hasCriticalChanges ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
                    {s.commitSave || 'Save Changes'}
                  </button>
                )}
              </div>
            )}
          </div>

        </form>
      </div>

      {/* Save confirm dialog */}
      {showConfirmPopup && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-xl max-w-sm w-full p-6 space-y-4 ${hasCriticalChanges ? 'border-amber-300 dark:border-amber-700 ring-4 ring-amber-50 dark:ring-amber-900/30' : 'border-slate-200 dark:border-slate-700'}`}>
            <div className={`flex items-center gap-3 ${hasCriticalChanges ? 'text-red-500' : 'text-amber-500'}`}>
              {hasCriticalChanges ? <AlertOctagon size={22} /> : <AlertTriangle size={22} />}
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {hasCriticalChanges ? (s.criticalPopupTitle || 'WARNING: Critical Shift') : (s.popupTitle || 'Confirm Settings Change')}
              </h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {hasCriticalChanges ? (s.criticalPopupBody || 'You are altering core financial fields or routing channels that affect settlement calculations.') : (s.popupBody || 'Are you sure you want to update and commit these changes?')}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowConfirmPopup(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer">
                {s.popupCancel || 'Cancel'}
              </button>
              <button type="button" onClick={handleConfirmSave}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer ${hasCriticalChanges ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                {s.popupConfirm || 'Yes, Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore confirm dialog */}
      {restoreConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-amber-300 dark:border-amber-700 ring-4 ring-amber-50 dark:ring-amber-900/30 shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-500">
              <RotateCcw size={22} />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{s.backupSection?.restoreConfirmTitle || 'Restore this backup?'}</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {s.backupSection?.restoreConfirmBody || 'All current data will be replaced with the selected backup. This cannot be undone.'}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-mono bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 break-all">
              {formatBackupName(restoreConfirm)}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setRestoreConfirm(null)} disabled={restoreLoading}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer">
                {s.backupSection?.cancel || 'Cancel'}
              </button>
              <button type="button" onClick={handleConfirmRestore} disabled={restoreLoading}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer">
                {restoreLoading ? '...' : (s.backupSection?.restoreConfirmBtn || 'Yes, Restore')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
