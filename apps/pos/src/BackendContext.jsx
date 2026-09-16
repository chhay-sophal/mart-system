import { createContext, useContext } from 'react';

const BackendContext = createContext('');
export const useBackend = () => useContext(BackendContext);
export default BackendContext;
