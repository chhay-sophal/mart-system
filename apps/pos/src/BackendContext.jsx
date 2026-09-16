import { createContext, useContext } from 'react';

// Carries the ApiClient instance (see App.jsx), not a bare URL string —
// its base URL is mutated in place via setBaseUrl() once Tauri's async
// port-discovery resolves the sidecar's port.
const BackendContext = createContext(null);
export const useBackend = () => useContext(BackendContext);
export default BackendContext;
