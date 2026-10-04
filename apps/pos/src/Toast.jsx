import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

// In-app messages, replacing window.alert(), which the Tauri window doesn't
// reliably show. Non-blocking on purpose: at the till a failed scan shouldn't
// stop the cashier (or the scanner) until they click OK.
const ToastContext = createContext(() => {});

const DURATION_MS = { error: 8000, success: 3000, info: 4000 };
const STYLES = {
  error: { icon: AlertTriangle, box: 'bg-rose-50 dark:bg-rose-950/80 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200' },
  success: { icon: CheckCircle2, box: 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200' },
  info: { icon: Info, box: 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200' },
};
const MAX_VISIBLE = 4;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    (message, type = 'error') => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, type }].slice(-MAX_VISIBLE));
      setTimeout(() => dismiss(id), DURATION_MS[type] ?? DURATION_MS.info);
    },
    [dismiss]
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 w-full max-w-md px-4 pointer-events-none" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const { icon: Icon, box } = STYLES[toast.type] ?? STYLES.info;
          return (
            <div key={toast.id} className={`pointer-events-auto w-full flex items-start gap-2.5 rounded-xl border shadow-lg px-4 py-3 text-sm font-semibold animate-fadeIn ${box}`}>
              <Icon size={16} className="flex-shrink-0 mt-0.5" />
              <span className="flex-1 break-words">{toast.message}</span>
              <button type="button" onClick={() => dismiss(toast.id)} className="flex-shrink-0 opacity-60 hover:opacity-100 cursor-pointer">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** notify(message, type?) with type 'error' (default), 'success' or 'info'. */
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext);
