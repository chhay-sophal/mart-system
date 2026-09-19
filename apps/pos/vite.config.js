import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  // Without this, Vite's default watcher covers the whole project root,
  // including src-tauri/target — cargo actively writes .dll/.exe files there
  // during `tauri dev`, and Vite trying to watch one mid-write causes an
  // EBUSY crash on Windows.
  server: {
    // Fixed and exclusive so Tauri's hardcoded devUrl always points at this
    // app, not whatever happens to be free -- Vite silently picking a
    // fallback port (e.g. when IMS's dev server already holds 5173) would
    // otherwise make the POS window load a different app entirely.
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
