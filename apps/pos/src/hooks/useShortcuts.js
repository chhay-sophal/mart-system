import { useEffect, useRef } from 'react';
import { RESERVED_COMBOS, comboFromEvent, worksWhileTyping } from '../shortcuts';

// Keyboard shortcuts (issue #7). `shortcuts` is the register's configured list
// ([{ action, keys }], see shortcuts.js); `actions` maps an action id to
// { run, when? } for the actions this screen handles. Several actions may
// share a key -- the first whose `when` holds wins.
//
// Function keys and Ctrl/Alt combos work even while typing in a field;
// others (arrows, Escape) are left to the field. A matched key's browser
// default is suppressed, and F5 / Ctrl+R always are, so the app can't reload
// mid-sale. Keys pressed into the Settings key recorder are ignored.

const isTyping = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function useShortcuts(shortcuts, actions, enabled = true) {
  // Latest config and handlers without re-subscribing every render.
  const latest = useRef({ shortcuts, actions });
  useEffect(() => {
    latest.current = { shortcuts, actions };
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e) => {
      if (e.target?.closest?.('[data-shortcut-recorder]')) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (RESERVED_COMBOS.includes(combo)) e.preventDefault();
      if (e.repeat) return;
      if (isTyping() && !worksWhileTyping(combo)) return;

      const { shortcuts: list, actions: handlers } = latest.current;
      const match = list
        .filter((s) => s.keys === combo)
        .map((s) => handlers[s.action])
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
