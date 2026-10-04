import { useState, useEffect } from 'react';
import { useBackend } from './BackendContext';
import { ApiError } from '@mart-system/api-client';
import { ArrowLeft, Store, CheckCircle2, AlertTriangle, AlertOctagon, HardDrive, RotateCcw, Download, FolderOpen, X, RefreshCw, Info, Cloud, Eye, EyeOff, Monitor, ImagePlus, Trash2, Smartphone, Keyboard, SlidersHorizontal } from 'lucide-react';
import { translations as t } from './locales';
import { DEFAULT_SYNC_BACKEND_URL } from './syncConfig';
import { STANDBY_IMAGE_KEY, imageFileToDataUrl } from './standbyImage';
import ShortcutList from './ShortcutList';
import { useShortcuts } from './hooks/useShortcuts';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from './Toast';

// Managed in IMS and written by sidecar sync.js on every pull. Settings never
// sends these back, so a save can't briefly revert a value IMS just pushed.
// Shop details and Bakong fields are per register now (issue #5): edited
// here and stored locally only.
const IMS_MANAGED_KEYS = ['exchange_rate', 'locale', 'main_currency'];
const SHOP_ICON_MAX_PX = 256; // header 40px, customer display 112px; @2x

// A labelled on/off switch for General settings.
function ToggleRow({ label, help, checked, onChange }) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span>
        <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {help && <span className="block text-xs text-slate-400 dark:text-slate-500 mt-0.5">{help}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

export default function SettingsManager({ onBackToRegister, currentLocale, onLocaleChange }) {
  const client = useBackend();
  const DEFAULT_SETTINGS = {
    // General (per register). Stored as 'true'/'false'; on unless turned off.
    show_low_stock_alert: 'true',
    // '' = follow the store's language from IMS; 'km' / 'en' = this register only.
    display_language: '',
    store_name: '',
    store_address: '',
    store_phone: '',
    store_icon: '',
    bakong_account_id: '',
    bakong_merchant_name: '',
    bakong_merchant_city: '',
    sync_backend_url: '',
    sync_terminal_id: '',
    sync_device_secret: '',
    [STANDBY_IMAGE_KEY]: ''
  };

  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [initialSettings, setInitialSettings] = useState({ ...DEFAULT_SETTINGS });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showConfirmPopup, setShowConfirmPopup] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [updateCheck, setUpdateCheck] = useState('idle'); // idle | checking | available | uptodate | error
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [activeSection, setActiveSection] = useState('general');
  const [showDeviceSecret, setShowDeviceSecret] = useState(false);
  const [overridingUrl, setOverridingUrl] = useState(false);
  const [standbyError, setStandbyError] = useState('');
  const [shopIconError, setShopIconError] = useState('');
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [storeLocale, setStoreLocale] = useState('km');
  const notify = useToast();
  const notices = t[currentLocale]?.notices || t.en.notices;

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
  const [syncStatus, setSyncStatus] = useState(null);

  const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);

  // Declared here (rather than lower down with the other handlers) so they're
  // defined before the mount effect below references them.
  const fetchSettings = async () => {
    try {
      const data = await client.get('/api/settings');
      if (data.locale) setStoreLocale(data.locale); // the store's language, for 'Store default'
      for (const key of IMS_MANAGED_KEYS) delete data[key];
      if (!data.sync_backend_url && DEFAULT_SYNC_BACKEND_URL) data.sync_backend_url = DEFAULT_SYNC_BACKEND_URL;
      setSettings(prev => ({ ...prev, ...data }));
      // Baseline includes the defaults, like the form does: a setting never
      // saved on this register (e.g. show_low_stock_alert = 'true') mustn't
      // count as an unsaved change.
      setInitialSettings({ ...DEFAULT_SETTINGS, ...data });
      setCloudFolder(data.cloud_backup_folder || '');
    } catch (err) {
      console.error('Failed to load store settings:', err);
    }
  };

  const fetchBackups = async () => {
    try {
      setBackups(await client.get('/api/backup/list'));
    } catch { /* best effort */ }
  };

  // Intentionally mount-once — fetchSettings/fetchBackups aren't memoized, so
  // listing them would refire this on every render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSettings();
    fetchBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polled only while this tab is open — the push/pull loop itself only logs
  // failures to the sidecar's own (invisible, background-process) console;
  // this is the surface an actual store owner/cashier can see.
  useEffect(() => {
    if (activeSection !== 'sync') return;
    const fetchSyncStatus = async () => {
      try {
        setSyncStatus(await client.get('/api/sync/status'));
      } catch {
        setSyncStatus(null);
      }
    };
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, 10_000);
    return () => clearInterval(interval);
  }, [activeSection, client]);

  useEffect(() => {
    if (!IS_TAURI) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => {});
  }, [IS_TAURI]);

  const handleBackupNow = async () => {
    setBackupLoading(true);
    try {
      await client.post('/api/backup/now');
      setBackupSuccess(true);
      setTimeout(() => setBackupSuccess(false), 3000);
      fetchBackups();
    } catch { /* best effort */ }
    setBackupLoading(false);
  };

  const handleConfirmRestore = async () => {
    if (!restoreConfirm) return;
    setRestoreLoading(true);
    try {
      await client.post('/api/backup/restore', { filename: restoreConfirm });
      setRestoreConfirm(null);
      setRestoreSuccess(true);
    } catch { /* best effort */ }
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
      await client.post('/api/backup/export', { filename, destPath });
      setExportedFile(filename);
      setTimeout(() => setExportedFile(null), 3000);
    } catch (err) {
      const reason = err instanceof ApiError && !err.isNetworkError ? err.body?.error : err.message;
      notify(notices.exportFailed.replace('{reason}', reason || notices.unknownError));
    }
    setExportingFile(null);
  };

  const saveCloudFolder = async (folder) => {
    setCloudFolderSaving(true);
    try {
      await client.put('/api/settings', { cloud_backup_folder: folder });
      setCloudFolder(folder);
    } catch { /* best effort */ }
    setCloudFolderSaving(false);
  };

  const handlePickCloudFolder = async () => {
    if (!IS_TAURI) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: 'Choose cloud backup folder' });
      if (selected) await saveCloudFolder(selected);
    } catch { /* best effort */ }
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
      await client.put('/api/settings', settings);
      setInitialSettings(settings);
      onLocaleChange?.(settings.display_language || storeLocale);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      if (err instanceof ApiError && !err.isNetworkError) {
        notify(t[currentLocale]?.settingsPage?.failSave || 'Failed to save settings.');
      } else {
        console.error('Error pushing updated options:', err);
        notify(notices.localServerUnreachable);
      }
    }
  };

  // General dirty form change tracker — use ?? '' so keys missing from the API
  // response (e.g. sync_terminal_id before pairing) don't cause a permanent dirty state.
  const hasChanges = Object.keys(settings).some(
    key => String(settings[key] ?? '') !== String(initialSettings[key] ?? '')
  );

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
          } catch { /* best effort */ }
        }
      });
      await relaunch();
    } catch {
      setUpdateCheck('error');
    }
  };

  // Leaving Settings discards unsaved changes, so ask first (in-app dialog;
  // window.confirm isn't reliably shown in the Tauri window).
  const requestLeave = () => (hasChanges ? setLeavePrompt(true) : onBackToRegister());

  // Esc (issue #7): close whichever prompt is open, otherwise leave. Handled
  // here rather than in App, which can't see unsaved changes.
  useShortcuts({
    back: {
      run: () => {
        if (leavePrompt) return setLeavePrompt(false);
        if (showConfirmPopup) return setShowConfirmPopup(false);
        requestLeave();
      },
    },
  });

  const navItems = [
    { id: 'general',  icon: SlidersHorizontal, label: s.generalSection?.header || 'General' },
    { id: 'store',    icon: Store,     label: s.storeProfileHeader || 'Store' },
    { id: 'khqr',     icon: Smartphone, label: s.bakongHeader || 'KHQR' },
    { id: 'display',  icon: Monitor,   label: s.standbySection?.header || 'Customer Display' },
    { id: 'shortcuts', icon: Keyboard, label: currentTranslations.shortcuts?.sectionHeader || 'Shortcuts' },
    { id: 'backup',   icon: HardDrive, label: s.backupSection?.header || 'Backup' },
    { id: 'sync',     icon: Cloud,     label: 'Backend Sync' },
    { id: 'about',    icon: Info,      label: 'About' },
  ];

  const isPaired = Boolean(settings.sync_backend_url && settings.sync_terminal_id && settings.sync_device_secret);

  const inputBase = 'w-full px-3 py-2.5 border rounded-xl text-sm font-medium bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-60 disabled:cursor-not-allowed';
  const inputNormal = `${inputBase} border-slate-200 dark:border-slate-700`;

  return (
    <div className="h-screen bg-slate-100 dark:bg-slate-950 flex flex-col overflow-hidden font-sans antialiased">

      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={requestLeave}
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

                {/* ── SHORTCUTS (read-only; fixed in shortcuts.js, issue #7) ── */}
                {activeSection === 'shortcuts' && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">{currentTranslations.shortcuts?.sectionHeader || 'Shortcuts'}</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{currentTranslations.shortcuts?.intro}</p>
                      <ShortcutList locale={currentLocale} />
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

                {/* ── GENERAL (per register) ── */}
                {activeSection === 'general' && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">{s.generalSection?.header || 'General'}</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{s.generalSection?.language || 'Display language'}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-2">{s.generalSection?.languageHelp}</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { val: '', label: `${s.generalSection?.storeDefault || 'Store default'} (${storeLocale === 'en' ? 'English' : 'ខ្មែរ'})` },
                            { val: 'km', label: '🇰🇭 ភាសាខ្មែរ' },
                            { val: 'en', label: '🇺🇸 English' },
                          ].map(({ val, label }) => (
                            <button key={val || 'default'} type="button"
                              onClick={() => setSettings((prev) => ({ ...prev, display_language: val }))}
                              className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${(settings.display_language || '') === val ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <ToggleRow
                        label={s.generalSection?.lowStockAlert || 'Show low-stock alert on the register'}
                        help={s.generalSection?.lowStockAlertHelp}
                        checked={settings.show_low_stock_alert !== 'false'}
                        onChange={(on) => setSettings((prev) => ({ ...prev, show_low_stock_alert: on ? 'true' : 'false' }))}
                      />
                      <p className="text-xs text-slate-400 dark:text-slate-500">{s.localOnlyNote || "Saved on this register only — it isn't synced to the server."}</p>
                    </div>
                  </div>
                )}

                {/* ── STORE (per register, issue #5) ── */}
                {activeSection === 'store' && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">{s.storeProfileHeader || 'Store Profile'}</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.localOnlyNote || "Saved on this register only — it isn't synced to the server."}</p>
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
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                setShopIconError('');
                                try {
                                  const dataUrl = await imageFileToDataUrl(file, SHOP_ICON_MAX_PX);
                                  setSettings((prev) => ({ ...prev, store_icon: dataUrl }));
                                } catch (err) {
                                  setShopIconError(err.message);
                                }
                              }} />
                          </label>
                          {settings.store_icon && (
                            <button type="button" onClick={() => setSettings((prev) => ({ ...prev, store_icon: '' }))}
                              className="text-[10px] text-slate-400 hover:text-red-500 transition-colors cursor-pointer">
                              {s.removeIcon || 'Remove'}
                            </button>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storeNameLabel || 'Store Name'}</label>
                          <input type="text" value={settings.store_name}
                            onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                            className={inputNormal} placeholder={s.storeNamePlaceholder || 'My Store'} />
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{s.storeNameHelp || 'Shown in the top-left corner of the register.'}</p>
                        </div>
                      </div>
                      {shopIconError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{shopIconError}</p>}
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storeAddressLabel || 'Store Address'}</label>
                        <input type="text" value={settings.store_address}
                          onChange={(e) => setSettings({ ...settings, store_address: e.target.value })}
                          className={inputNormal} placeholder={s.storeAddressPlaceholder || 'Village, Commune, District, Province'} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storePhoneLabel || 'Phone Number'}</label>
                        <input type="text" value={settings.store_phone}
                          onChange={(e) => setSettings({ ...settings, store_phone: e.target.value })}
                          className={inputNormal} placeholder={s.storePhonePlaceholder || '012 345 678'} />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── KHQR (per register, issue #5) ── */}
                {activeSection === 'khqr' && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">{s.bakongHeader || 'KHQR Profile'}</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{s.localOnlyNote || "Saved on this register only — it isn't synced to the server."}</p>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.bakongAccountId || 'Bakong Account ID'}</label>
                        <input type="text" value={settings.bakong_account_id}
                          onChange={(e) => setSettings({ ...settings, bakong_account_id: e.target.value })}
                          className={`${inputNormal} font-mono text-indigo-600 dark:text-indigo-400`}
                          placeholder="store_account@abaa" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.shopNameLabel || 'Merchant Name'}</label>
                          <input type="text" value={settings.bakong_merchant_name}
                            onChange={(e) => setSettings({ ...settings, bakong_merchant_name: e.target.value })}
                            className={inputNormal} placeholder="Baby Mart" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{s.storeCityLabel || 'City'}</label>
                          <input type="text" value={settings.bakong_merchant_city}
                            onChange={(e) => setSettings({ ...settings, bakong_merchant_city: e.target.value })}
                            className={inputNormal} placeholder="Phnom Penh" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── CUSTOMER DISPLAY ── */}
                {activeSection === 'display' && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">{s.standbySection?.title || 'Standby Image'}</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {s.standbySection?.help || "Shown full screen on the customer display while no sale is in progress. Stored on this register only; it isn't synced."}
                      </p>
                      <div className="aspect-video rounded-xl bg-slate-900 overflow-hidden flex items-center justify-center">
                        {settings[STANDBY_IMAGE_KEY]
                          ? <img src={settings[STANDBY_IMAGE_KEY]} alt="" className="w-full h-full object-contain" />
                          : <span className="text-xs text-slate-500 px-4 text-center">{s.standbySection?.none || 'No image — the shop name is shown instead'}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer">
                          <ImagePlus size={12} />
                          {s.standbySection?.choose || 'Choose Image'}
                          <input type="file" accept="image/*" className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              setStandbyError('');
                              try {
                                const dataUrl = await imageFileToDataUrl(file);
                                setSettings((prev) => ({ ...prev, [STANDBY_IMAGE_KEY]: dataUrl }));
                              } catch (err) {
                                setStandbyError(err.message);
                              }
                            }} />
                        </label>
                        {settings[STANDBY_IMAGE_KEY] && (
                          <button type="button" onClick={() => setSettings((prev) => ({ ...prev, [STANDBY_IMAGE_KEY]: '' }))}
                            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-red-400 hover:text-red-600 text-slate-500 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer">
                            <Trash2 size={12} />
                            {s.standbySection?.remove || 'Remove'}
                          </button>
                        )}
                      </div>
                      {standbyError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{standbyError}</p>}
                    </div>
                  </div>
                )}

                {/* ── SYNC ── */}
                {activeSection === 'sync' && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Backend Sync</p>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Enter the values from IMS's terminal-pairing screen to connect this register to the central backend.
                        Once connected, product catalog management moves to IMS — this terminal's local product list becomes read-only.
                      </p>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Backend URL</label>
                        {DEFAULT_SYNC_BACKEND_URL && !overridingUrl && settings.sync_backend_url === DEFAULT_SYNC_BACKEND_URL ? (
                          <div className="flex items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <span className="truncate">{settings.sync_backend_url}</span>
                            <button type="button" onClick={() => setOverridingUrl(true)}
                              className="shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                              Override
                            </button>
                          </div>
                        ) : (
                          <>
                            <input type="text" value={settings.sync_backend_url}
                              onChange={(e) => setSettings({ ...settings, sync_backend_url: e.target.value })}
                              className={inputNormal} placeholder="https://api.example.com" />
                            {DEFAULT_SYNC_BACKEND_URL && (
                              <button type="button"
                                onClick={() => { setSettings({ ...settings, sync_backend_url: DEFAULT_SYNC_BACKEND_URL }); setOverridingUrl(false); }}
                                className="mt-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                                Use default ({DEFAULT_SYNC_BACKEND_URL})
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Terminal ID</label>
                        <input type="text" value={settings.sync_terminal_id}
                          onChange={(e) => setSettings({ ...settings, sync_terminal_id: e.target.value })}
                          className={inputNormal} placeholder="cl9ebqhxk00003b600tymydho" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Device Secret</label>
                        <div className="relative">
                          <input type={showDeviceSecret ? 'text' : 'password'} value={settings.sync_device_secret}
                            onChange={(e) => setSettings({ ...settings, sync_device_secret: e.target.value })}
                            className={`${inputNormal} pr-10`} placeholder="Shown once when the terminal was paired in IMS" />
                          <button type="button" onClick={() => setShowDeviceSecret((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            {showDeviceSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                      <div className={`flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2.5 ${isPaired ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400'}`}>
                        {isPaired ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        {isPaired ? 'Connected — sales sync to the backend automatically.' : 'Not connected — this terminal is offline-only.'}
                      </div>
                      {isPaired && syncStatus && (syncStatus.pendingCount > 0 || syncStatus.failedCount > 0) && (
                        <div className="flex flex-col gap-1 text-xs font-semibold rounded-xl px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={14} />
                            {syncStatus.pendingCount > 0 && `${syncStatus.pendingCount} sale(s) waiting to sync`}
                            {syncStatus.pendingCount > 0 && syncStatus.failedCount > 0 && ' — '}
                            {syncStatus.failedCount > 0 && `${syncStatus.failedCount} failed, retrying`}
                          </div>
                          {syncStatus.lastError && (
                            <p className="text-[10px] font-normal text-amber-600 dark:text-amber-500 pl-5">{syncStatus.lastError}</p>
                          )}
                        </div>
                      )}
                      {isPaired && syncStatus?.deadCount > 0 && (
                        <div className="flex flex-col gap-1 text-xs font-semibold rounded-xl px-3 py-2.5 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400">
                          <div className="flex items-center gap-2">
                            <AlertOctagon size={14} />
                            {syncStatus.deadCount} sale(s) could not sync — needs a manual check, not just a wait
                          </div>
                        </div>
                      )}
                    </div>
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
                    className={`px-5 py-2 font-bold rounded-xl text-sm transition-colors cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white`}>
                    {s.commitSave || 'Save Changes'}
                  </button>
                )}
              </div>
            )}
          </div>

        </form>
      </div>

      {leavePrompt && (
        <ConfirmDialog
          title={currentTranslations.shortcuts?.leaveTitle || 'Unsaved changes'}
          body={currentTranslations.shortcuts?.confirmDiscard || 'Leave Settings without saving your changes?'}
          cancelLabel={currentTranslations.shortcuts?.leaveStay || 'Stay'}
          confirmLabel={currentTranslations.shortcuts?.leaveConfirm || 'Leave without saving'}
          onCancel={() => setLeavePrompt(false)}
          onConfirm={() => {
            setLeavePrompt(false);
            onBackToRegister();
          }}
          danger
        />
      )}

      {/* Save confirm dialog */}
      {showConfirmPopup && (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-xl max-w-sm w-full p-6 space-y-4 border-slate-200 dark:border-slate-700`}>
            <div className={`flex items-center gap-3 text-amber-500`}>
              <AlertTriangle size={22} />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {s.popupTitle || 'Confirm Settings Change'}
              </h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {s.popupBody || 'Are you sure you want to update and commit these changes?'}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowConfirmPopup(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer">
                {s.popupCancel || 'Cancel'}
              </button>
              <button type="button" onClick={handleConfirmSave}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer bg-indigo-600 hover:bg-indigo-700`}>
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
