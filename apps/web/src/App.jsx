import { Route, Routes } from 'react-router-dom';
import { MART_NAME } from './lib/config.js';

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<p className="p-8 font-display text-3xl font-bold">{MART_NAME}</p>} />
    </Routes>
  );
}
