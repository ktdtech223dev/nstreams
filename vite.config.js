import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

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
    // Bake platform + version into the bundle
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
      ...(isAndroid ? { 'import.meta.env.VITE_PLATFORM': JSON.stringify('android') } : {}),
    },
  };
});
