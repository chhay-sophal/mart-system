import { useEffect, useRef, useState } from 'react';

/**
 * Tracks which column's filter dropdown is open (one at a time) and closes
 * it on an outside click or Escape. Pairs with components/FilterableHeader.jsx.
 */
export function useColumnFilter() {
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const filterPanelRef = useRef(null);
  const toggleFilterCol = (col) => setOpenFilterCol((prev) => (prev === col ? null : col));

  useEffect(() => {
    if (!openFilterCol) return;
    const onPointerDown = (e) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target)) setOpenFilterCol(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpenFilterCol(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openFilterCol]);

  return { openFilterCol, toggleFilterCol, filterPanelRef };
}
