import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const isAndroid = process.env.VITE_PLATFORM === 'android';

  return {
    plugins: [react()],
    // Capacitor requires an absolute base path for assets
    base: isAndroid ? '/' : './',
    server: {
      port: 5173,
      strictPort: true
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Top-level await used in main.jsx for the capacitor shim
      target: isAndroid ? 'es2022' : 'es2015',
    },
    // Make VITE_PLATFORM available inside the app
    define: isAndroid
      ? { 'import.meta.env.VITE_PLATFORM': JSON.stringify('android') }
      : {},
  };
});
