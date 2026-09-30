import { ApiClient } from '@mart-system/api-client';
import { API_BASE_URL } from './config.js';

// No auth: the storefront only ever calls the backend's public, read-only routes.
const client = new ApiClient({ baseUrl: API_BASE_URL });

export const api = {
  listStores: () => client.get('/api/public/stores'),
  listProducts: (storeId) => client.get(`/api/public/stores/${storeId}/products`),
  getProduct: (storeId, productId) => client.get(`/api/public/stores/${storeId}/products/${productId}`),
  getAvailability: (productId) => client.get(`/api/public/products/${productId}/availability`),
};
