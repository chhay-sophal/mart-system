import { useEffect, useRef, useState } from 'react';

// Auto-hiding sticky header (issue #2): hidden while scrolling down, shown
// again as soon as the user scrolls up, and always shown near the top of the
// page. Scroll movements smaller than JITTER_PX (trackpad wobble, momentum
// tails) are ignored so the header doesn't flicker. The work per scroll event
// is a few comparisons, and React skips re-rendering when `hidden` is
// unchanged, so it runs directly in the (passive) scroll listener.
const JITTER_PX = 6;

export function useHeadroom(headerRef) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY.current;
      if (Math.abs(delta) < JITTER_PX) return;
      const headerHeight = headerRef.current?.offsetHeight ?? 0;
      // Near the top there's nothing to make room for: keep it shown.
      setHidden(y > headerHeight && delta > 0);
      lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [headerRef]);

  // Tabbing into the hidden header brings it back.
  const show = () => setHidden(false);
  return { hidden, show };
}
