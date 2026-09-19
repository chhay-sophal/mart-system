import { useState } from 'react';
import { Cloud, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { ApiError } from '@mart-system/api-client';

const inputClass =
  'w-full px-3 py-2.5 border rounded-xl text-sm font-medium bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all';

// Shown instead of LockScreen when this terminal has never been paired --
// staff_pins starts empty and only sync.js's pullCatalog() ever fills it, so
// without this screen a fresh install has no PIN that could ever work and no
// way to reach SettingsManager's Sync section (that's gated behind a session,
// which itself requires a working PIN). This is the one place credentials
// are entered without a PIN, and only while the sidecar reports unpaired.
export default function FirstRunSetup({ client, onPaired }) {
  const [backendUrl, setBackendUrl] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [deviceSecret, setDeviceSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | saving | syncing | error
  const [errorMessage, setErrorMessage] = useState('');

  const submitting = status === 'saving' || status === 'syncing';

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('saving');
    setErrorMessage('');
    try {
      await client.put('/api/settings', {
        sync_backend_url: backendUrl.trim(),
        sync_terminal_id: terminalId.trim(),
        sync_device_secret: deviceSecret.trim(),
      });
      setStatus('syncing');
      await client.post('/api/sync/now');
      onPaired();
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof ApiError
          ? err.body?.error || 'Could not pair this terminal.'
          : "Could not reach this terminal's local server."
      );
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 gap-6 font-sans antialiased px-4">
      <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg">
        <Cloud size={22} className="text-white" />
      </div>
      <div className="text-center">
        <h1 className="text-base font-bold text-slate-900 dark:text-white">Set up this terminal</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm">
          This terminal hasn't been paired yet. Enter the values from IMS's terminal-pairing screen to connect it.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-4"
      >
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Backend URL</label>
          <input
            required
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="https://api.example.com"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Terminal ID</label>
          <input
            required
            type="text"
            value={terminalId}
            onChange={(e) => setTerminalId(e.target.value)}
            placeholder="cl9ebqhxk00003b600tymydho"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Device Secret</label>
          <div className="relative">
            <input
              required
              type={showSecret ? 'text' : 'password'}
              value={deviceSecret}
              onChange={(e) => setDeviceSecret(e.target.value)}
              placeholder="Shown once when the terminal was paired in IMS"
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {status === 'error' && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <AlertTriangle size={13} /> {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className={`w-full h-11 rounded-xl font-bold text-sm transition-all ${
            submitting
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
          }`}
        >
          {status === 'saving' ? 'Saving…' : status === 'syncing' ? 'Syncing staff…' : 'Pair terminal'}
        </button>
      </form>
    </div>
  );
}
