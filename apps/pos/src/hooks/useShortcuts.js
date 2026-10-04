import { useEffect, useRef } from 'react';

// Keyboard shortcuts (issue #7). Bindings are { keys, run, when? }, e.g.
// { keys: 'F3', run: openHistory } or { keys: 'Ctrl+Enter', run: checkout }.
//
// Function keys and Ctrl combos work even while typing in a field -- that's
// the point of them at a till -- and never collide with the barcode scanner,
// which only "types" characters and Enter. Keys a field needs for itself
// (arrows, Escape, plain letters) are skipped while a field has focus.
// A matched key's browser default is suppressed (F5 would otherwise reload
// the app mid-sale); unmatched keys pass through untouched.

const isTyping = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

function comboOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

const worksWhileTyping = (combo) => /^F\d{1,2}$/.test(combo) || combo.startsWith('Ctrl+');

export function useShortcuts(bindings, enabled = true) {
  // Latest bindings without re-subscribing every render (handlers close over state).
  const bindingsRef = useRef(bindings);
  useEffect(() => {
    bindingsRef.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const combo = comboOf(e);
      if (isTyping() && !worksWhileTyping(combo)) return;
      const binding = bindingsRef.current.find((b) => b.keys === combo && (b.when?.() ?? true));
      if (!binding) return;
      e.preventDefault();
      e.stopPropagation();
      binding.run(e);
    };
    // Capture phase, so a shortcut wins over the register's scanner listener.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
