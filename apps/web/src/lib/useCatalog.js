import { api } from './api.js';
import { useBranch } from '../state/BranchContext.jsx';
import { useResource } from './useResource.js';

/** The selected branch's full public catalog. */
export function useCatalog() {
  const { branch } = useBranch();
  return useResource(branch ? `catalog:${branch.id}` : null, () => api.listProducts(branch.id));
}
