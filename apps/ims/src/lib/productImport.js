import { apiClient } from './apiClient';

// Batched: the backend's JSON body limit is 100KB (~800 rows), and a real
// online-pos catalog is well past that. Each batch is its own transaction,
// so if one fails the earlier batches stay imported; the error carries the
// totals so far, and re-running with updateExisting is safe.
const IMPORT_BATCH_SIZE = 300;

export async function importProductsInBatches(storeId, products, updateExisting, onProgress) {
  const totals = { imported: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    for (let i = 0; i < products.length; i += IMPORT_BATCH_SIZE) {
      onProgress?.(i);
      const res = await apiClient.post(`/api/stores/${storeId}/products/bulk-import`, {
        products: products.slice(i, i + IMPORT_BATCH_SIZE),
        updateExisting,
      });
      for (const key of Object.keys(totals)) totals[key] += res[key] ?? 0;
    }
    onProgress?.(products.length);
    return totals;
  } catch (err) {
    err.partialTotals = totals;
    throw err;
  }
}
