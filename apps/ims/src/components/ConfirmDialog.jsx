import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal.jsx';

const ConfirmContext = createContext(null);

/**
 * Renders window.confirm()'s native dialog as the app's own Modal instead,
 * so it matches IMS's styling (and dark mode) rather than the browser chrome.
 * Exposes an async confirm(message, options) -- same call shape as
 * window.confirm, just returning a Promise<boolean> instead of a boolean,
 * so every existing call site only needs `await` added in front of it.
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setRequest({
        message,
        title: options.title ?? 'Please confirm',
        confirmLabel: options.confirmLabel ?? 'Confirm',
        danger: options.danger ?? false,
      });
    });
  }, []);

  function settle(result) {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setRequest(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal title={request.title} onClose={() => settle(false)} width="max-w-sm">
          <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{request.message}</p>
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => settle(false)}
              className="text-sm px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              autoFocus
              className={`text-sm font-medium text-white rounded-lg px-3 h-9 inline-flex items-center justify-center border border-transparent cursor-pointer ${
                request.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--accent)]'
              }`}
            >
              {request.confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider');
  return confirm;
}
