import { Keyboard, X } from 'lucide-react';
import { translations as t } from './locales';
import ShortcutList from './ShortcutList';

// The F1 cheat sheet (issue #7).
export default function ShortcutHelp({ locale, onClose }) {
  const s = t[locale]?.shortcuts || t.en.shortcuts;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <Keyboard size={18} /> {s.title}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <ShortcutList locale={locale} />
      </div>
    </div>
  );
}
