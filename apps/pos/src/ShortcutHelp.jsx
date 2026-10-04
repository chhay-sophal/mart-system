import { Keyboard, X } from 'lucide-react';
import { translations as t } from './locales';
import { SHORTCUT_ACTIONS, displayCombo } from './shortcuts';

const GROUPS = [
  { id: 'general', titleKey: 'groupGeneral' },
  { id: 'register', titleKey: 'groupRegister' },
  { id: 'summary', titleKey: 'groupSummary' },
];

// The cheat sheet (issue #7): this register's configured shortcuts, grouped
// by where they apply. Edited in Settings > Shortcuts.
export default function ShortcutHelp({ locale, shortcuts, onClose }) {
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
        <div className="space-y-4">
          {GROUPS.map((group) => {
            const actions = SHORTCUT_ACTIONS.filter((a) => a.group === group.id);
            return (
              <div key={group.id}>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{s[group.titleKey]}</p>
                <div className="space-y-1.5">
                  {actions.map((action) => {
                    const combos = shortcuts.filter((sh) => sh.action === action.id).map((sh) => sh.keys);
                    return (
                      <div key={action.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-600 dark:text-slate-300">{s[action.id]}</span>
                        <span className="flex flex-wrap justify-end gap-1">
                          {combos.length === 0 ? (
                            <span className="text-xs text-slate-400">{s.noKeys}</span>
                          ) : (
                            combos.map((combo) => (
                              <kbd
                                key={combo}
                                className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200"
                              >
                                {displayCombo(combo)}
                              </kbd>
                            ))
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
