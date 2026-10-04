import { useEffect, useRef } from 'react';
import { RESERVED_COMBOS, SHORTCUTS, comboFromEvent, worksWhileTyping } from '../shortcuts';

// Keyboard shortcuts (issue #7). `actions` maps an action id from
// shortcuts.js to { run, when? } for the actions this screen handles; the
// keys themselves are fixed in shortcuts.js. Several actions may share a key
// -- the first whose `when` holds wins.
//
// Function keys and Ctrl/Alt combos work even while typing in a field;
// others (arrows, Escape) are left to the field. A matched key's browser
// default is suppressed, and F5 / Ctrl+R always are, so the app can't reload
// mid-sale.

const isTyping = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function useShortcuts(actions, enabled = true) {
  // Latest handlers without re-subscribing every render.
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e) => {
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (RESERVED_COMBOS.includes(combo)) e.preventDefault();
      if (e.repeat) return;
      if (isTyping() && !worksWhileTyping(combo)) return;

      const match = SHORTCUTS.filter((s) => s.keys === combo)
        .map((s) => latest.current[s.action])
        .find((handler) => handler && (handler.when?.() ?? true));
      if (!match) return;
      e.preventDefault();
      e.stopPropagation();
      match.run(e);
    };
    // Capture phase, so a shortcut wins over the register's scanner listener.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
