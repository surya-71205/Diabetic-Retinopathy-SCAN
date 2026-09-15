import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/DR-MobileNetV3-main/**'],
    },
  },
});
