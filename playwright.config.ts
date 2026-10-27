import { defineConfig, devices } from '@playwright/test';

const project = process.env.SPINEL_E2E_PROJECT;
const shard = process.env.SHARD?.replaceAll('/', '-of-');
if (
  project &&
  ![
    'development',
    'production',
    'mobile-https',
    'sync-development',
    'sync-production',
    'sync-soak-sheet',
    'sync-soak-doc',
    'offline-upgrade',
  ].includes(project)
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
  // Keep independent native-client and offline lifecycle scenarios observable;
  // the production fixtures do not depend on earlier cases succeeding.
  // Other suites still stop repeated downstream failures early.
  maxFailures: process.env.CI && project !== 'production' && !project?.startsWith('sync-') ? 1 : 0,
  // Keep per-project/shard CI results outside outputDir, which Playwright clears.
  // The existing artifact upload preserves these alongside failure traces.
  reporter: process.env.CI
    ? [
        ['line'],
        [
          'json',
          { outputFile: `playwright-report/${project ?? 'all'}${shard ? `-${shard}` : ''}.json` },
        ],
      ]
    : 'line',
  // Recording every action/DOM snapshot distorts the real-time latency checks.
  // Keep CI failure diagnostics on its first retry; all assertions still run.
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'development',
      // Offline downloads need the production build's app-shell manifest.
      testIgnore: [
        '**/pwa.spec.ts',
        '**/offline.spec.ts',
        '**/offline-editing.spec.ts',
        '**/offline-creation.spec.ts',
        '**/offline-recovery.spec.ts',
        '**/offline-device.spec.ts',
        '**/offline-sign-out.spec.ts',
        '**/offline-upgrade.spec.ts',
        '**/sync-client.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100' },
    },
    {
      name: 'production',
      testIgnore: [
        '**/pwa.spec.ts',
        '**/offline-editing.spec.ts',
        '**/offline-creation.spec.ts',
        '**/offline-recovery.spec.ts',
        '**/offline-upgrade.spec.ts',
        '**/sync-client.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3101' },
    },
    {
      name: 'sync-development',
      testMatch: ['**/sync-client.spec.ts', '**/doc-mobile.spec.ts'],
      grepInvert: /@sync-soak/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3104' },
    },
    {
      name: 'sync-production',
      // Offline editing needs both the production shell and the read-only
      // native snapshot observer already enabled in this browser partition.
      testMatch: [
        '**/sync-client.spec.ts',
        '**/doc-mobile.spec.ts',
        '**/offline-editing.spec.ts',
        '**/offline-creation.spec.ts',
        '**/offline-recovery.spec.ts',
      ],
      grepInvert: /@sync-soak/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3105' },
    },
    ...(['sheet', 'doc'] as const).map((kind) => ({
      name: `sync-soak-${kind}`,
      testMatch: '**/sync-client.spec.ts',
      grep: new RegExp(`seeded two-editor ${kind} sync soak`),
      use: {
        ...devices['Desktop Chrome'],
        baseURL: kind === 'sheet' ? 'http://localhost:3106' : 'http://localhost:3107',
      },
    })),
    {
      name: 'offline-upgrade',
      // This suite builds the legacy baseline and two current compatibility
      // fixtures. Its own server/browser must not race a normal webServer.
      testMatch: '**/offline-upgrade.spec.ts',
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
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
        VITE_SYNC_EVIDENCE: '0',
        VITE_DOC_SELECTION_EVIDENCE: process.env.VITE_DOC_SELECTION_EVIDENCE ?? '0',
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
        VITE_SYNC_EVIDENCE: '0',
        VITE_DOC_SELECTION_EVIDENCE: process.env.VITE_DOC_SELECTION_EVIDENCE ?? '0',
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
        VITE_SYNC_EVIDENCE: '1',
        VITE_DOC_SELECTION_EVIDENCE: '0',
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
        VITE_SYNC_EVIDENCE: '1',
        VITE_DOC_SELECTION_EVIDENCE: '0',
      },
      reuseExistingServer: false,
    },
    ...(['sheet', 'doc'] as const).map((kind) => ({
      command: 'npm start',
      url: `http://localhost:${kind === 'sheet' ? 3106 : 3107}/sign-in`,
      env: {
        PORT: kind === 'sheet' ? '3106' : '3107',
        HOST: '127.0.0.1',
        DATABASE_PATH: `test-results/sync-soak-${kind}/app.sqlite`,
        VITE_SYNC_EVIDENCE: '1',
        VITE_DOC_SELECTION_EVIDENCE: '0',
      },
      reuseExistingServer: false,
    })),
    {
      command: 'node --max-old-space-size=256 --max-semi-space-size=8 scripts/e2e-https.ts',
      url: 'https://localhost:3103/sign-in',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
    },
  ].filter(
    (server) =>
      !project ||
      (project !== 'offline-upgrade' &&
        server.url.includes(
          project === 'development'
            ? ':3100/'
            : project === 'production'
              ? ':3101/'
              : project === 'sync-development'
                ? ':3104/'
                : project === 'sync-production'
                  ? ':3105/'
                  : project === 'sync-soak-sheet'
                    ? ':3106/'
                    : project === 'sync-soak-doc'
                      ? ':3107/'
                      : ':3103/',
        )),
  ),
});
