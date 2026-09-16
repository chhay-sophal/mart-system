import { createContext, useContext } from 'react';

// Carries the ApiClient instance (see App.jsx), not a bare URL string —
// its base URL is mutated in place via setBaseUrl() once Tauri's async
// port-discovery resolves the sidecar's port.
const BackendContext = createContext(null);
// Splitting this hook into its own file to satisfy Fast Refresh would touch
// every one of its ~5 importers for a DX-only (not correctness) rule.
// eslint-disable-next-line react-refresh/only-export-components
export const useBackend = () => useContext(BackendContext);
export default BackendContext;
