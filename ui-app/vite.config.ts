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
      // Dev must run the SAME galaxy config the embedded server injects, or
      // every harness visual acceptance judges a different galaxy than
      // production renders. With no server up this 404s and index.html's
      // classic script falls through to the bundled defaults — which the
      // shared fixture test pins to the server payload anyway.
      '/runtime-config.js': { target: 'http://localhost:7001', changeOrigin: true },
    },
  },
});
