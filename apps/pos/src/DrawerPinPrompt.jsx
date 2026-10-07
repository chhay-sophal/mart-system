import { useState } from 'react';
import { Lock } from 'lucide-react';

// Gates a manual drawer open behind the PIN set in Settings > Drawer >
// Require a PIN to open the drawer. Same overlay style as ConfirmDialog.
export default function DrawerPinPrompt({ pin, onConfirm, onCancel, t = {} }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (value === pin) {
      onConfirm();
    } else {
      setError(true);
      setValue('');
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <form
        onSubmit={submit}
        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 text-indigo-600 dark:text-indigo-400">
          <Lock size={22} />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.title || 'Enter drawer PIN'}</h3>
        </div>
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 4));
            setError(false);
          }}
          placeholder="••••"
          className="w-full text-center tracking-[0.5em] text-2xl font-bold border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {error && <p className="text-xs font-semibold text-red-500">{t.wrongPin || 'Incorrect PIN'}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            {t.cancel || 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={value.length !== 4}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            {t.confirm || 'Open'}
          </button>
        </div>
      </form>
    </div>
  );
}
