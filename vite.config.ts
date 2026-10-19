import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Language layout data must arrive with the renderer, before offline editing.
// Group the open-source renderer's dynamic dictionaries in both build modes.
const rendererChunks = {
  groups: [{ name: 'univer-renderer', test: /node_modules[\\/]@univerjs[\\/]engine-render[\\/]/ }],
};

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [react()],
  define: {
    'import.meta.env.SPINEL_RECOVERY_PROBE': JSON.stringify(
      process.env.SPINEL_RECOVERY_PROBE === '1',
    ),
  },
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
