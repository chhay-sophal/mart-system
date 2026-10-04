import { useEffect, useRef, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { translations as t } from './locales';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  comboFromEvent,
  displayCombo,
  isSafeCombo,
  parseShortcuts,
  serializeShortcuts,
} from './shortcuts';

// Settings > Shortcuts (issue #7): see, change, add and delete the keys for
// each action on this register. `value` is the stored keyboard_shortcuts
// setting ('' = defaults); edits go back through `onChange` and are saved
// with the rest of Settings.
let nextRowId = 0;
const withIds = (list) => list.map((s) => ({ ...s, rowId: nextRowId++ }));
const withoutKey = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== String(key)));

export default function ShortcutSettings({ value, onChange, locale }) {
  const s = t[locale]?.shortcuts || t.en.shortcuts;
  // Local rows, so a just-added row without keys yet isn't dropped on re-render.
  const [rows, setRows] = useState(() => withIds(parseShortcuts(value)));
  const [recordingId, setRecordingId] = useState(null);
  const [errors, setErrors] = useState({}); // rowId -> message

  const publish = (next) => {
    setRows(next);
    onChange(serializeShortcuts(next.filter((r) => r.keys)));
  };

  const updateRow = (rowId, patch) => publish(rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const removeRow = (rowId) => {
    if (recordingId === rowId) setRecordingId(null);
    setErrors((prev) => withoutKey(prev, rowId));
    publish(rows.filter((r) => r.rowId !== rowId));
  };

  const addRow = () => {
    const row = { action: SHORTCUT_ACTIONS[0].id, keys: '', rowId: nextRowId++ };
    setRows([...rows, row]); // not published until it has keys
    setRecordingId(row.rowId);
  };

  const resetDefaults = () => {
    setRecordingId(null);
    setErrors({});
    setRows(withIds(DEFAULT_SHORTCUTS));
    onChange(''); // '' = defaults, so later changes to the defaults still apply
  };

  const record = (row, e) => {
    e.preventDefault();
    e.stopPropagation();
    const combo = comboFromEvent(e);
    if (!combo) return; // a modifier on its own; wait for the rest
    if (!isSafeCombo(combo)) {
      setErrors((prev) => ({ ...prev, [row.rowId]: `${displayCombo(combo)}: ${s.unsafe}` }));
      return;
    }
    const clash = rows.find((r) => r.rowId !== row.rowId && r.keys === combo);
    if (clash) {
      setErrors((prev) => ({ ...prev, [row.rowId]: `${displayCombo(combo)}: ${s.duplicate} "${s[clash.action]}"` }));
      return;
    }
    setErrors((prev) => withoutKey(prev, row.rowId));
    setRecordingId(null);
    updateRow(row.rowId, { keys: combo });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{s.sectionHeader}</p>
        <button
          type="button"
          onClick={resetDefaults}
          className="px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 text-slate-500 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw size={11} /> {s.resetDefaults}
        </button>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">{s.intro}</p>
        <div className="grid grid-cols-[1fr_auto] gap-x-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
          <span>{s.colAction}</span>
          <span>{s.colKeys}</span>
        </div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.rowId}>
              <div className="flex items-center gap-2">
                <select
                  value={row.action}
                  onChange={(e) => updateRow(row.rowId, { action: e.target.value })}
                  className="flex-1 min-w-0 px-2.5 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                >
                  {SHORTCUT_ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>{s[a.id]}</option>
                  ))}
                </select>
                {recordingId === row.rowId ? (
                  <KeyRecorder label={s.pressKeys} onKeyDown={(e) => record(row, e)} onCancel={() => setRecordingId(null)} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setRecordingId(row.rowId)}
                    title={s.change}
                    className="min-w-28 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-400 cursor-pointer"
                  >
                    {row.keys ? displayCombo(row.keys) : s.change}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeRow(row.rowId)}
                  title={s.remove}
                  className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {errors[row.rowId] && <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1 px-1">{errors[row.rowId]}</p>}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus size={12} /> {s.add}
        </button>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">{s.reserved}</p>
      </div>
    </div>
  );
}

// Focused while waiting for a key combination. data-shortcut-recorder tells
// the app-wide shortcut listener to leave these key presses alone.
function KeyRecorder({ label, onKeyDown, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={0}
      data-shortcut-recorder=""
      onKeyDown={onKeyDown}
      onBlur={onCancel}
      className="min-w-28 px-3 py-2 rounded-xl border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-xs font-semibold text-indigo-700 dark:text-indigo-300 text-center outline-hidden animate-pulse"
    >
      {label}
    </div>
  );
}
