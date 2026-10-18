import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Each HTTP fixture now loads the real collaboration runtime. Keep the
    // integration suite within the small CI host's memory instead of swapping.
    maxWorkers: 1,
  },
});
