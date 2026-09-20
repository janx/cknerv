import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { bootFaces } from './vite-boot-faces';

function bootstrapStaticGraph(): Plugin {
  return {
    name: 'cknerv-bootstrap-static-graph',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const entry = chunks.find((chunk) => (
        chunk.isEntry && Object.keys(chunk.modules).some((moduleId) => moduleId.endsWith('/src/main.tsx'))
      ));
      if (!entry) this.error('could not locate the main.tsx output chunk');
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const files: string[] = [];
      const modules = new Set<string>();
      const visit = (fileName: string): void => {
        if (files.includes(fileName)) return;
        const chunk = byFile.get(fileName);
        if (!chunk) this.error(`missing static chunk ${fileName}`);
        files.push(fileName);
        for (const moduleId of Object.keys(chunk.modules)) modules.add(moduleId);
        for (const imported of chunk.imports) visit(imported);
      };
      visit(entry.fileName);
      this.emitFile({
        type: 'asset',
        fileName: '.vite/bootstrap-static-graph.json',
        source: `${JSON.stringify({ entry: entry.fileName, files, modules: [...modules].sort() }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  base: '/',
  // `bootFaces` puts the shell's two faces and the ◇ glyph's in the document
  // head, with a preload each, so the boot band is one typeface from the first
  // paint instead of three inside the first second (report E, E-2).
  plugins: [react(), bootFaces(), bootstrapStaticGraph()],
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
    manifest: true,
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
