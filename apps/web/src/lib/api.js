import { ApiClient } from '@mart-system/api-client';
import { API_BASE_URL } from './config.js';

// No auth: the storefront only ever calls the backend's public routes.
const client = new ApiClient({ baseUrl: API_BASE_URL });

export const api = {
  listStores: () => client.get('/api/public/stores'),
  listProducts: (storeId) => client.get(`/api/public/stores/${storeId}/products`),
  getProduct: (storeId, productId) => client.get(`/api/public/stores/${storeId}/products/${productId}`),
  getAvailability: (productId) => client.get(`/api/public/products/${productId}/availability`),
  getPickupSlots: (storeId) => client.get(`/api/public/stores/${storeId}/pickup-slots`),
  placeOrder: (storeId, body) => client.post(`/api/public/stores/${storeId}/orders`, body),
  getOrder: (token) => client.get(`/api/public/orders/${encodeURIComponent(token)}`),
};
