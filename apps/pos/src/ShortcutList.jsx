import { translations as t } from './locales';
import { SHORTCUT_ACTIONS, SHORTCUTS, displayCombo } from './shortcuts';

const GROUPS = [
  { id: 'general', titleKey: 'groupGeneral' },
  { id: 'register', titleKey: 'groupRegister' },
  { id: 'summary', titleKey: 'groupSummary' },
];

// The fixed shortcuts (shortcuts.js), grouped by where they apply. Shown in
// the F1 cheat sheet and in Settings > Shortcuts.
export default function ShortcutList({ locale }) {
  const s = t[locale]?.shortcuts || t.en.shortcuts;
  return (
    <div className="space-y-4">
      {GROUPS.map((group) => (
        <div key={group.id}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{s[group.titleKey]}</p>
          <div className="space-y-1.5">
            {SHORTCUT_ACTIONS.filter((a) => a.group === group.id).map((action) => (
              <div key={action.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-600 dark:text-slate-300">{s[action.id]}</span>
                <span className="flex flex-wrap justify-end gap-1">
                  {SHORTCUTS.filter((sh) => sh.action === action.id).map((sh) => (
                    <kbd
                      key={sh.keys}
                      className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200"
                    >
                      {displayCombo(sh.keys)}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
