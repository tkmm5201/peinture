import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    base: './',
    plugins: [react()],

    envPrefix: 'VITE_',
    envDir: '.',

    build: {
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-ui': ['sonner', 'lucide-react', 'react-zoom-pan-pinch'],
            'vendor-store': ['zustand'],
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
});
