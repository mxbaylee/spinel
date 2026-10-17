import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'development',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3100' },
    },
    { name: 'production', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3101' } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --no-open',
      url: 'http://127.0.0.1:3100/api/health',
      env: { PORT: '3100', HOST: '127.0.0.1', DATABASE_PATH: 'test-results/dev.sqlite' },
      reuseExistingServer: false,
    },
    {
      command: 'npm start',
      url: 'http://127.0.0.1:3101/api/health',
      env: { PORT: '3101', HOST: '127.0.0.1', DATABASE_PATH: 'test-results/production.sqlite' },
      reuseExistingServer: false,
    },
  ],
});
