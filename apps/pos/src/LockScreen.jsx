import { useState, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { useBackend } from './BackendContext';
import { ApiError } from '@mart-system/api-client';
import { translations as t } from './locales';

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
const MAX_PIN_LENGTH = 8;
const MIN_PIN_LENGTH = 4;

export default function LockScreen({ currentLocale, onUnlock }) {
  const client = useBackend();
  const s = t[currentLocale]?.lockScreen || t['km'].lockScreen;
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (pin.length < MIN_PIN_LENGTH || submitting) return;
    setSubmitting(true);
    try {
      const data = await client.post('/api/auth/pin-unlock', { pin });
      onUnlock({ userId: data.userId, name: data.name, role: data.role });
    } catch (err) {
      setError(true);
      setPin('');
      if (!(err instanceof ApiError)) console.error('PIN unlock failed:', err);
    }
    setSubmitting(false);
  }

  // Supports a physical keyboard (not just the on-screen keypad) — this is a
  // shared terminal, some setups have a keyboard attached at the register.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key >= '0' && e.key <= '9') {
        setError(false);
        setPin((prev) => (prev.length >= MAX_PIN_LENGTH ? prev : prev + e.key));
      } else if (e.key === 'Backspace') {
        setError(false);
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === 'Enter') {
        submit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, submitting]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 gap-6 font-sans antialiased">
      <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg">
        <Lock size={22} className="text-white" />
      </div>
      <div className="text-center">
        <h1 className="text-base font-bold text-slate-900 dark:text-white">{s.title}</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{s.subtitle}</p>
      </div>

      <div className="flex gap-3">
        {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`w-3 h-3 rounded-full border-2 transition-colors ${
              i < pin.length ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-700'
            }`}
          />
        ))}
      </div>

      <p className={`text-xs font-bold text-rose-500 h-4 ${error ? '' : 'invisible'}`}>{s.wrongPin}</p>

      <div className="grid grid-cols-3 gap-3 w-64">
        {KEYPAD.map((key, i) => {
          if (key === '') return <div key={i} />;
          if (key === 'back') {
            return (
              <button
                key={i}
                onClick={() => { setError(false); setPin((prev) => prev.slice(0, -1)); }}
                className="h-16 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-bold text-sm flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                ⌫
              </button>
            );
          }
          return (
            <button
              key={i}
              onClick={() => { setError(false); setPin((prev) => (prev.length >= MAX_PIN_LENGTH ? prev : prev + key)); }}
              className="h-16 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-bold text-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {key}
            </button>
          );
        })}
      </div>

      <button
        onClick={submit}
        disabled={pin.length < MIN_PIN_LENGTH || submitting}
        className={`w-64 h-12 rounded-xl font-bold text-sm transition-all ${
          pin.length < MIN_PIN_LENGTH || submitting
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
            : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
        }`}
      >
        {submitting ? '...' : s.unlockBtn}
      </button>
    </div>
  );
}
