import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { existsSync } from 'fs';

const isWebMode = process.env.VITE_WEB_MODE === 'true' || existsSync('.env.development');

export default defineConfig({
  plugins: [
    react(),
    // In web mode, skip singleFile bundling — Express serves static assets
    !isWebMode && viteSingleFile(),
  ].filter(Boolean),
  server: {
    port: 5174,
    host: true,
    proxy: isWebMode
      ? {
          '/api': {
            target: 'http://localhost:3001',
            changeOrigin: true,
            ws: true,
          },
        }
      : undefined,
  },
  build: {
    minify: 'esbuild',
    esbuild: {
      drop: ['console', 'debugger'],
    },
    assetsInlineLimit: 1024 * 1024,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});

