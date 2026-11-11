import { defineConfig } from 'vite';

// SPN-146 comparison page (see type.ts): a stock Univer Doc with none of Spinel's layers.
export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: '../../../../test-results/stock-univer', emptyOutDir: true },
  preview: { port: 4999, strictPort: true },
});
