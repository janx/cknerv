import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { bootFaces } from './vite-boot-faces';

export default defineConfig({
  base: '/',
  // `bootFaces` puts the shell's two faces and the ◇ glyph's in the document
  // head, with a preload each, so the boot band is one typeface from the first
  // paint instead of three inside the first second (report E, E-2).
  plugins: [react(), bootFaces()],
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
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Fonts always emit as their own asset. Left to the 4KB default a small
    // subset lands base64 inside the entry chunk, which costs a third more
    // bytes than the file and drags the face through the JS cache key on
    // every unrelated UI change.
    assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? false : undefined),
  },
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
