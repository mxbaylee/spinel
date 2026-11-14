import { expect, test } from 'vitest';
import { diagnosticsConfiguration } from './configuration.ts';

test('diagnostics never selects the configured application filename or publishes its image locator', () => {
  const digest = 'a'.repeat(64);
  expect(
    diagnosticsConfiguration(
      '/data/diagnostics.sqlite',
      `ghcr.io/private/project@sha256:${digest}`,
    ),
  ).toEqual({
    applicationPath: '/data/diagnostics.sqlite',
    path: '/data/diagnostics-events.sqlite',
    build: digest,
  });
  expect(diagnosticsConfiguration('/data/spinel.sqlite', 'private-image:branch')).toMatchObject({
    path: '/data/diagnostics.sqlite',
    build: 'unknown',
  });
});
