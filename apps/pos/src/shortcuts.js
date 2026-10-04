// Keyboard shortcut configuration (issue #7). Actions are fixed -- each needs
// code behind it (App.jsx, DailySummary.jsx) -- while the key combinations
// bound to them are editable per register in Settings > Shortcuts, stored in
// the local keyboard_shortcuts setting (never synced). '' = the defaults.

export const SHORTCUTS_SETTING_KEY = 'keyboard_shortcuts';

// group: where the action applies, for the cheat sheet and the editor.
export const SHORTCUT_ACTIONS = [
  { id: 'help', group: 'general' },
  { id: 'register', group: 'general' },
  { id: 'history', group: 'general' },
  { id: 'summary', group: 'general' },
  { id: 'settings', group: 'general' },
  { id: 'back', group: 'general' },
  { id: 'lock', group: 'general' },
  { id: 'manualBarcode', group: 'register' },
  { id: 'payCash', group: 'register' },
  { id: 'payKhqr', group: 'register' },
  { id: 'payStaticQr', group: 'register' },
  { id: 'checkout', group: 'register' },
  { id: 'clearCart', group: 'register' },
  { id: 'prevDay', group: 'summary' },
  { id: 'nextDay', group: 'summary' },
];

export const DEFAULT_SHORTCUTS = [
  { action: 'help', keys: 'F1' },
  { action: 'register', keys: 'F2' },
  { action: 'history', keys: 'F3' },
  { action: 'summary', keys: 'F4' },
  { action: 'settings', keys: 'F9' },
  { action: 'back', keys: 'Escape' },
  { action: 'lock', keys: 'Ctrl+L' },
  { action: 'manualBarcode', keys: 'F5' },
  { action: 'payCash', keys: 'F6' },
  { action: 'payKhqr', keys: 'F7' },
  { action: 'payStaticQr', keys: 'F8' },
  { action: 'checkout', keys: 'F10' },
  { action: 'checkout', keys: 'Ctrl+Enter' },
  { action: 'clearCart', keys: 'Ctrl+Delete' },
  { action: 'prevDay', keys: 'ArrowLeft' },
  { action: 'nextDay', keys: 'ArrowRight' },
];

// Kept from reloading the app mid-sale even when nothing is bound to them.
export const RESERVED_COMBOS = ['F5', 'Ctrl+R'];

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'];

/** "Ctrl+Shift+K", "F3", "ArrowLeft"; null for a lone modifier key. */
export function comboFromEvent(e) {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

const isFunctionKey = (key) => /^F([1-9]|1[0-2])$/.test(key);
const SAFE_LONE_KEYS = ['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'];

/**
 * A barcode scanner "types" characters and Enter, and cashiers type into
 * fields, so a shortcut must not be one of those on its own (or with only
 * Shift). Function keys, Ctrl/Alt combos and a few navigation keys are safe.
 */
export function isSafeCombo(combo) {
  if (!combo) return false;
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (isFunctionKey(key)) return true;
  if (mods.includes('Ctrl') || mods.includes('Alt')) return true;
  return mods.length === 0 && SAFE_LONE_KEYS.includes(key);
}

/** Function keys and Ctrl/Alt combos also work while a text field has focus. */
export const worksWhileTyping = (combo) => {
  const parts = combo.split('+');
  return isFunctionKey(parts[parts.length - 1]) || parts.includes('Ctrl') || parts.includes('Alt');
};

/** Readable form for the UI: "Ctrl + ←". */
export function displayCombo(combo) {
  const names = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Delete: 'Del' };
  return combo
    .split('+')
    .map((part) => names[part] ?? part)
    .join(' + ');
}

/** The stored setting -> a clean list; anything unreadable falls back to the defaults. */
export function parseShortcuts(value) {
  if (!value) return DEFAULT_SHORTCUTS;
  try {
    const list = JSON.parse(value);
    if (!Array.isArray(list)) return DEFAULT_SHORTCUTS;
    const actionIds = new Set(SHORTCUT_ACTIONS.map((a) => a.id));
    return list.filter((s) => s && actionIds.has(s.action) && typeof s.keys === 'string' && isSafeCombo(s.keys));
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export const serializeShortcuts = (list) => JSON.stringify(list.map(({ action, keys }) => ({ action, keys })));

/** Combos for one action, e.g. for tooltips: ['F10', 'Ctrl+Enter']. */
export const combosFor = (list, action) => list.filter((s) => s.action === action).map((s) => s.keys);
