import { AlertTriangle } from 'lucide-react';

// In-app confirmation, in the same style as Settings' save prompt. Used in
// place of window.confirm(), which the Tauri window doesn't reliably show.
export default function ConfirmDialog({ title, body, cancelLabel, confirmLabel, onCancel, onConfirm, danger = false }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center gap-3 ${danger ? 'text-red-500' : 'text-amber-500'}`}>
          <AlertTriangle size={22} />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            // The safe choice has focus, so a reflex Enter never discards anything.
            autoFocus
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
