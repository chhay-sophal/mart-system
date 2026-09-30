import { getOpenStatus } from './hours.js';
import { useNow } from './useNow.js';

/** Short status text for tight spots like the branch bar; null when hours aren't listed. */
export function useOpenLabel(store) {
  const now = useNow();
  return store ? (getOpenStatus(store.openingHours, store.timezone, now)?.label ?? null) : null;
}
