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
  optimizeDeps: { rolldownOptions: { output: { codeSplitting: rendererChunks } } },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rolldownOptions: { output: { codeSplitting: rendererChunks } },
  },
});
