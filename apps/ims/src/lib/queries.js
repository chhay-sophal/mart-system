import { apiClient } from './apiClient';
import { queryKeys } from './queryClient';

// Query definitions read by more than one page, so they all fetch (and
// cache) the same thing the same way.

// Global lists, archived included (see queryKeys): any store the user can
// access serves for the URL, which only checks that access.
export const suppliersQuery = (storeId) => ({
  queryKey: queryKeys.suppliers(),
  queryFn: () => apiClient.get(`/api/stores/${storeId}/suppliers?includeDeleted=true`),
  enabled: Boolean(storeId),
});

export const categoriesQuery = (storeId) => ({
  queryKey: queryKeys.categories(),
  queryFn: () => apiClient.get(`/api/stores/${storeId}/categories?includeDeleted=true`),
  enabled: Boolean(storeId),
});
