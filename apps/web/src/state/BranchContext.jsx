import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { readJson, writeJson } from '../lib/storage.js';
import { useResource } from '../lib/useResource.js';

const STORAGE_KEY = 'storefront.branchId';
const BranchContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch must be used inside <BranchProvider>');
  return ctx;
}

export function BranchProvider({ children }) {
  const stores = useResource('stores', api.listStores);
  const [chosenId, setChosenId] = useState(() => readJson(STORAGE_KEY, null));

  const chooseBranch = useCallback((storeId) => {
    setChosenId(storeId);
    writeJson(STORAGE_KEY, storeId);
  }, []);

  const value = useMemo(() => {
    const list = stores.data ?? [];
    // A remembered branch can since have been closed — fall back to the first open one.
    const branch = list.find((s) => s.id === chosenId) ?? list[0] ?? null;
    return {
      stores: list,
      branch,
      chooseBranch,
      loading: stores.loading,
      error: stores.error,
      reload: stores.reload,
    };
  }, [stores.data, stores.loading, stores.error, stores.reload, chosenId, chooseBranch]);

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}
