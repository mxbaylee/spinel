import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { shellFiles, SHELL_PLACEHOLDER } from './src/shared/offlineShell.ts';

// Language layout data must arrive with the renderer, before offline editing.
// Group the open-source renderer's dynamic dictionaries in both build modes.
const rendererChunks = {
  groups: [{ name: 'univer-renderer', test: /node_modules[\\/]@univerjs[\\/]engine-render[\\/]/ }],
};

// Write the offline app shell (docs/offline.md) into the built service worker.
// Its contents change with every build, so browsers install the new worker.
function offlineShell(): Plugin {
  return {
    name: 'spinel-offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = shellFiles(Object.keys(bundle));
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16);
      const worker = bundle['service-worker.js'];
      if (worker?.type !== 'chunk') return this.error('The service worker was not built.');
      const token = new RegExp(`(["'\`])${SHELL_PLACEHOLDER}\\1`, 'g');
      const found = worker.code.match(token)?.length ?? 0;
      if (found !== 1) return this.error(`Expected one shell manifest token, found ${found}.`);
      worker.code = worker.code.replace(token, JSON.stringify(JSON.stringify({ version, files })));
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [react(), offlineShell()],
  optimizeDeps: { rolldownOptions: { output: { codeSplitting: rendererChunks } } },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./web/index.html', import.meta.url)),
        'service-worker': fileURLToPath(new URL('./web/service-worker.ts', import.meta.url)),
      },
      output: {
        codeSplitting: rendererChunks,
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
