import { defineConfig, devices } from '@playwright/test';

const project = process.env.SPINEL_E2E_PROJECT;
if (project && !['development', 'production'].includes(project))
  throw new Error('SPINEL_E2E_PROJECT must be development or production.');

export default defineConfig({
  testDir: './e2e',
  // Keep each build's failure traces and disposable database when the other runs.
  outputDir: project ? `test-results/${project}` : 'test-results',
  fullyParallel: true,
  // Each test can start two real collaboration editors; isolate their latency
  // assertions from unrelated browser workloads and bound CI memory use.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  // Stop repeated downstream failures early; a failed run still fails the gate.
  maxFailures: process.env.CI ? 1 : 0,
  reporter: 'line',
  // Recording every action/DOM snapshot distorts the real-time latency checks.
  // Keep CI failure diagnostics on its first retry; all assertions still run.
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'development',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100' },
    },
    { name: 'production', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3101' } },
  ],
  webServer: [
    {
      // Vite still serves development modules. A second Node file watcher is
      // unnecessary for fixed-source tests and adds work to cold SDK imports.
      command: 'node server/index.ts --dev --no-open',
      url: 'http://localhost:3100/sign-in',
      env: {
        PORT: '3100',
        HOST: '127.0.0.1',
        DATABASE_PATH: 'test-results/development/app.sqlite',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm start',
      url: 'http://localhost:3101/sign-in',
      env: { PORT: '3101', HOST: '127.0.0.1', DATABASE_PATH: 'test-results/production/app.sqlite' },
      reuseExistingServer: false,
    },
  ].filter(
    (server) => !project || server.url.includes(project === 'development' ? ':3100/' : ':3101/'),
  ),
});
