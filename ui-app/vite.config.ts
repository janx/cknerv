import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  // Force singletons — keeps leva + R3F from going double-mounted when
  // consumed via workspace symlinks (same reasoning as simulator/ui).
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
      '@react-three/drei',
      'leva',
    ],
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5181, // dev mode — different from simulator's 5180
    proxy: {
      '/api': { target: 'http://localhost:7001', ws: true, changeOrigin: true },
    },
  },
});
