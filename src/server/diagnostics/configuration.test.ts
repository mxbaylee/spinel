import { expect, test } from 'vitest';
import { diagnosticsConfiguration, diagnosticsRetentionDays } from './configuration.ts';

test('diagnostics never selects the configured application filename or publishes its image locator', () => {
  const digest = 'a'.repeat(64);
  expect(
    diagnosticsConfiguration(
      '/data/diagnostics.sqlite',
      `ghcr.io/private/project@sha256:${digest}`,
    ),
  ).toEqual({
    applicationPath: '/data/diagnostics.sqlite',
    retentionDays: 7,
    path: '/data/diagnostics-events.sqlite',
    build: digest,
  });
  expect(diagnosticsConfiguration('/data/spinel.sqlite', 'private-image:branch')).toMatchObject({
    path: '/data/diagnostics.sqlite',
    build: 'unknown',
  });
});

test('deployment retention defaults to seven days and accepts a shorter whole-day policy', () => {
  expect(diagnosticsRetentionDays()).toBe(7);
  expect(diagnosticsRetentionDays('1')).toBe(1);
  expect(diagnosticsConfiguration('/data/spinel.sqlite', undefined, 3).retentionDays).toBe(3);
});

test.each(['', '0', '8', '-1', '1.5', '1e0', ' 1', 'Infinity', 0, 8, 1.5, NaN, Infinity])(
  'rejects invalid retention %s instead of silently changing the policy',
  (value) => {
    expect(() => diagnosticsRetentionDays(value)).toThrow('DIAGNOSTICS_RETENTION_DAYS');
  },
);
