import { useEffect, useState } from 'react';
import { readFilterState, writeFilterState } from '../lib/filterState';

/**
 * useState that's remembered under `key` across page visits. With no key
 * it's plain useState, so shared hooks can make remembering opt-in.
 * `restore(saved)` can vet a saved value (return undefined to discard it).
 */
export function usePersistentState(key, initial, restore = (saved) => saved) {
  const [value, setValue] = useState(() => {
    const saved = key ? readFilterState(key) : undefined;
    const restored = saved !== undefined ? restore(saved) : undefined;
    return restored !== undefined ? restored : typeof initial === 'function' ? initial() : initial;
  });
  useEffect(() => {
    if (key) writeFilterState(key, value);
  }, [key, value]);
  return [value, setValue];
}
