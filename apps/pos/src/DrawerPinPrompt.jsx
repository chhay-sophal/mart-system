import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
// Every PIN is exactly 4 digits; unlocking starts as soon as the fourth one is entered.
const PIN_LENGTH = 4;

// Gates a manual drawer open behind the PIN set in Settings > Drawer >
// Require a PIN to open the drawer. Same dot-indicator + on-screen keypad as
// the register's own PIN unlock (LockScreen.jsx), just in a dismissible
// popup instead of a full screen -- this is a quick re-entry check, not a
// fresh sign-in.
export default function DrawerPinPrompt({ pin, onConfirm, onCancel, t = {} }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  function submit() {
    if (value === pin) {
      onConfirm();
    } else {
      setError(true);
      setValue('');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value.length === PIN_LENGTH) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Supports a physical keyboard, same as LockScreen.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key >= '0' && e.key <= '9') {
        setError(false);
        setValue((prev) => (prev.length >= PIN_LENGTH ? prev : prev + e.key));
      } else if (e.key === 'Backspace') {
        setError(false);
        setValue((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function press(key) {
    setError(false);
    if (key === 'back') setValue((prev) => prev.slice(0, -1));
    else setValue((prev) => (prev.length >= PIN_LENGTH ? prev : prev + key));
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl w-full max-w-xs p-6 flex flex-col items-center gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg">
          <Lock size={22} className="text-white" />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white -mt-1">{t.title || 'Enter drawer PIN'}</h3>

        <div className="flex gap-4">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-colors ${
                i < value.length ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-700'
              }`}
            />
          ))}
        </div>

        <p className={`text-xs font-bold text-rose-500 h-4 text-center px-4 ${error ? '' : 'invisible'}`}>{t.wrongPin || 'Incorrect PIN'}</p>

        <div className="grid grid-cols-3 gap-2.5 w-full">
          {KEYPAD.map((key, i) => {
            if (key === '') return <div key={i} />;
            return (
              <button
                key={i}
                type="button"
                onClick={() => press(key)}
                className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-bold text-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {key === 'back' ? '⌫' : key}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="w-full px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
        >
          {t.cancel || 'Cancel'}
        </button>
      </div>
    </div>
  );
}
