// Keyboard shortcuts (issue #7). Fixed for every register: what each action
// does lives in App.jsx (and DailySummary.jsx for the day keys); the F1 cheat
// sheet and Settings > Shortcuts list them from here.
//
// Only function keys, Ctrl combos and a few navigation keys are used: a
// barcode scanner "types" characters and Enter, so plain keys would fire on
// every scan.

// group: where the action applies, for the lists.
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

export const SHORTCUTS = [
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

// Kept from reloading the app mid-sale (F5 is also bound above).
export const RESERVED_COMBOS = ['F5', 'Ctrl+R'];

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'];

/** "Ctrl+Enter", "F3", "ArrowLeft"; null for a lone modifier key. */
export function comboFromEvent(e) {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

/**
 * Function keys, Ctrl/Alt combos and Esc also work while a text field has
 * focus (Esc does nothing useful in these fields, and leaving a screen right
 * after editing one is exactly when it's pressed). Arrows stay with the field.
 */
export const worksWhileTyping = (combo) => {
  const parts = combo.split('+');
  return combo === 'Escape' || /^F([1-9]|1[0-2])$/.test(parts[parts.length - 1]) || parts.includes('Ctrl') || parts.includes('Alt');
};

/** Readable form for the UI: "Ctrl + ←". */
export function displayCombo(combo) {
  const names = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Delete: 'Del' };
  return combo
    .split('+')
    .map((part) => names[part] ?? part)
    .join(' + ');
}

/** Combos for one action, e.g. for tooltips: ['F10', 'Ctrl+Enter']. */
export const combosFor = (action) => SHORTCUTS.filter((s) => s.action === action).map((s) => s.keys);
