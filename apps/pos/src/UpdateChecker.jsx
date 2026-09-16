import React, { useState, useEffect, useRef } from 'react';

export default function UpdateChecker() {
  const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);
  const updateRef = useRef(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | available | downloading | installing | error
  const [progress, setProgress] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [contentLength, setContentLength] = useState(0);

  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;

    (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (cancelled || !update) return;
        updateRef.current = update;
        setUpdateInfo({ version: update.version, body: update.body ?? '' });
        setStatus('available');
      } catch (err) {
        // Silent fail — don't interrupt the user if update check fails
        console.error('Update check failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [IS_TAURI]);

  const handleInstall = async () => {
    setStatus('downloading');
    setProgress(0);
    setContentLength(0);
    setErrorMsg('');

    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = updateRef.current;
      if (!update) { setStatus('idle'); setShowModal(false); return; }

      let downloaded = 0;
      let total = 0;

      await update.downloadAndInstall(async (event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          setContentLength(total);
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (total > 0) setProgress(Math.round((downloaded / total) * 100));
        } else if (event.event === 'Finished') {
          setProgress(100);
          setStatus('installing');
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('kill_backend');
          } catch (_) {}
        }
      });

      await relaunch();
    } catch (err) {
      console.error('Update installation failed:', err);
      setErrorMsg(err?.message ?? 'Unknown error');
      setStatus('error');
    }
  };

  if (!IS_TAURI || status === 'idle') return null;

  const isWorking = status === 'downloading' || status === 'installing';

  return (
    <>
      {status === 'available' && (
        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
        >
          ↑ v{updateInfo?.version}
        </button>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (!isWorking && e.target === e.currentTarget) setShowModal(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-[90vw]">
            <h2 className="text-base font-bold text-slate-900 mb-0.5">Update Available</h2>
            <p className="text-xs text-slate-500 mb-4">Version <span className="font-semibold text-slate-700">{updateInfo?.version}</span> is ready to install</p>

            {updateInfo?.body && (
              <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs text-slate-600 max-h-28 overflow-y-auto whitespace-pre-wrap border border-slate-100">
                {updateInfo.body}
              </div>
            )}

            {isWorking && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                  <span>{status === 'installing' ? 'Installing...' : contentLength === 0 ? 'Downloading...' : `Downloading... ${progress}%`}</span>
                  {status === 'downloading' && progress > 0 && <span>{progress}%</span>}
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full bg-indigo-600 transition-all ${progress === 0 ? 'w-full animate-pulse' : ''}`}
                    style={{ width: progress > 0 ? `${progress}%` : '100%' }}
                  />
                </div>
              </div>
            )}

            {status === 'error' && (
              <p className="text-xs text-red-600 mb-4 bg-red-50 rounded-xl p-2.5 border border-red-100">
                Installation failed{errorMsg ? `: ${errorMsg}` : ''}. Please try again or download manually from GitHub.
              </p>
            )}

            <div className="flex gap-2 justify-end">
              {!isWorking && (
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Later
                </button>
              )}
              {(status === 'available' || status === 'error') && (
                <button
                  onClick={handleInstall}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors"
                >
                  Install & Restart
                </button>
              )}
              {isWorking && (
                <p className="text-xs text-slate-500 self-center">
                  {status === 'installing' ? 'Installing — please wait...' : 'Downloading update...'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
