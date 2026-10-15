import { useLayoutEffect, useState } from 'react';

const HIDDEN = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

/**
 * Fixed-position style for a dropdown panel anchored to a button, kept fully
 * inside the viewport. Render the panel through a portal with this style.
 *
 * Horizontally it lines up with the anchor's left edge (prefer: 'start') or
 * right edge ('end'), flips to the other edge when that would overflow, and
 * is finally clamped `margin` px inside the window. Vertically it opens below
 * the anchor, or above when the panel doesn't fit below and there's more room
 * above; its max-height is capped to the room on the chosen side, so a tall
 * panel scrolls internally instead of running off the page. Re-measured on
 * resize and on any scroll (capture), so it follows the anchor.
 */
export function useAnchoredPosition(anchorRef, panelRef, open, { prefer = 'start', gap = 4, margin = 8 } = {}) {
  const [style, setStyle] = useState(HIDDEN);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;

      const width = Math.min(panel.offsetWidth, vw - 2 * margin);
      const startLeft = a.left;
      const endLeft = a.right - width;
      const fits = (left) => left >= margin && left + width <= vw - margin;
      let left = prefer === 'end' ? (fits(endLeft) ? endLeft : startLeft) : fits(startLeft) ? startLeft : endLeft;
      left = Math.max(margin, Math.min(left, vw - margin - width));

      const roomBelow = vh - a.bottom - gap - margin;
      const roomAbove = a.top - gap - margin;
      const below = panel.scrollHeight <= roomBelow || roomBelow >= roomAbove;

      setStyle({
        position: 'fixed',
        left,
        maxWidth: vw - 2 * margin,
        maxHeight: Math.max(below ? roomBelow : roomAbove, 120),
        overflowY: 'auto',
        ...(below ? { top: a.bottom + gap } : { bottom: vh - a.top + gap }),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      setStyle(HIDDEN);
    };
  }, [open, anchorRef, panelRef, prefer, gap, margin]);

  return style;
}
