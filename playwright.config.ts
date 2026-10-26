import { defineConfig, devices } from '@playwright/test';

const project = process.env.SPINEL_E2E_PROJECT;
if (
  project &&
  !['development', 'production', 'mobile-https', 'sync-development', 'sync-production'].includes(
    project,
  )
)
  throw new Error('SPINEL_E2E_PROJECT must name a configured browser project.');

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
  // Keep all five independent native-client acceptance scenarios observable;
  // ordinary large suites still stop repeated downstream failures early.
  maxFailures: process.env.CI && !project?.startsWith('sync-') ? 1 : 0,
  reporter: 'line',
  // Recording every action/DOM snapshot distorts the real-time latency checks.
  // Keep CI failure diagnostics on its first retry; all assertions still run.
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'development',
      // Offline downloads need the production build's app-shell manifest.
      testIgnore: ['**/pwa.spec.ts', '**/offline.spec.ts', '**/sync-client.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100' },
    },
    {
      name: 'production',
      testIgnore: ['**/pwa.spec.ts', '**/sync-client.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3101' },
    },
    {
      name: 'sync-development',
      testMatch: '**/sync-client.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3104' },
    },
    {
      name: 'sync-production',
      testMatch: '**/sync-client.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3105' },
    },
    {
      name: 'mobile-https',
      testMatch: ['**/pwa.spec.ts', '**/doc-mobile.spec.ts'],
      use: {
        ...devices['Pixel 7'],
        baseURL: 'https://localhost:3103',
        ignoreHTTPSErrors: true,
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
  ],
  webServer: [
    {
      // Vite still serves development modules. A second Node file watcher is
      // unnecessary for fixed-source tests and adds work to cold SDK imports.
      command:
        'node --max-old-space-size=512 --max-semi-space-size=8 server/index.ts --dev --no-open',
      url: 'http://localhost:3100/sign-in',
      env: {
        PORT: '3100',
        HOST: '127.0.0.1',
        DATABASE_PATH: 'test-results/development/app.sqlite',
        SPINEL_SYNC_SERVER: '0',
        VITE_SYNC_EVIDENCE: '0',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm start',
      url: 'http://localhost:3101/sign-in',
      env: {
        PORT: '3101',
        HOST: '127.0.0.1',
        DATABASE_PATH: 'test-results/production/app.sqlite',
        SPINEL_SYNC_SERVER: '0',
        VITE_SYNC_EVIDENCE: '0',
      },
      reuseExistingServer: false,
    },
    {
      command:
        'node --max-old-space-size=512 --max-semi-space-size=8 server/index.ts --dev --no-open',
      url: 'http://localhost:3104/sign-in',
      env: {
        PORT: '3104',
        HOST: '127.0.0.1',
        DATABASE_PATH: 'test-results/sync-development/app.sqlite',
        SPINEL_SYNC_SERVER: '1',
        VITE_SYNC_EVIDENCE: '1',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm start',
      url: 'http://localhost:3105/sign-in',
      env: {
        PORT: '3105',
        HOST: '127.0.0.1',
        DATABASE_PATH: 'test-results/sync-production/app.sqlite',
        SPINEL_SYNC_SERVER: '1',
        VITE_SYNC_EVIDENCE: '1',
      },
      reuseExistingServer: false,
    },
    {
      command: 'node --max-old-space-size=256 --max-semi-space-size=8 scripts/e2e-https.ts',
      url: 'https://localhost:3103/sign-in',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
    },
  ].filter(
    (server) =>
      !project ||
      server.url.includes(
        project === 'development'
          ? ':3100/'
          : project === 'production'
            ? ':3101/'
            : project === 'sync-development'
              ? ':3104/'
              : project === 'sync-production'
                ? ':3105/'
                : ':3103/',
      ),
  ),
});
