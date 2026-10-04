import { Keyboard, X } from 'lucide-react';
import { translations as t } from './locales';

// The F1 cheat sheet (issue #7). Kept in one place so the list shown here
// and the bindings in App.jsx are easy to compare.
const SHORTCUT_GROUPS = [
  {
    titleKey: 'groupGeneral',
    items: [
      ['F1', 'help'],
      ['F2', 'register'],
      ['F3', 'history'],
      ['F4', 'summary'],
      ['F9', 'settings'],
      ['Esc', 'back'],
      ['Ctrl + L', 'lock'],
    ],
  },
  {
    titleKey: 'groupRegister',
    items: [
      ['F5', 'manualBarcode'],
      ['F6', 'payCash'],
      ['F7', 'payKhqr'],
      ['F8', 'payStaticQr'],
      ['F10 / Ctrl + Enter', 'checkout'],
      ['Ctrl + Delete', 'clearCart'],
    ],
  },
  {
    titleKey: 'groupSummary',
    items: [['← / →', 'prevNextDay']],
  },
];

export default function ShortcutHelp({ locale, onClose }) {
  const s = t[locale]?.shortcuts || t.en.shortcuts;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl w-full max-w-lg p-6"
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
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.titleKey}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{s[group.titleKey]}</p>
              <div className="space-y-1.5">
                {group.items.map(([keys, labelKey]) => (
                  <div key={labelKey} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">{s[labelKey]}</span>
                    <kbd className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
