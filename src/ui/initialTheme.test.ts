import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { initialThemeScript } from './initialTheme.ts';

for (const [preference, systemDark, expected] of [
  ['light', true, 'light'],
  ['dark', false, 'dark'],
  ['system', true, 'dark'],
  ['unrecognized', false, 'light'],
  [null, true, 'dark'],
] as const) {
  test(`public initial theme honors ${preference} with system dark=${systemDark}`, () => {
    const root = { dataset: {}, style: {} };
    runInNewContext(initialThemeScript, {
      localStorage: { getItem: () => preference },
      matchMedia: () => ({ matches: systemDark }),
      document: { documentElement: root },
    });
    expect(root.dataset).toEqual({ theme: expected });
    expect(root.style).toEqual({ colorScheme: expected });
  });
}
test('blocked theme storage cannot leave startup unstyled or prevent the application', () => {
  const root = { dataset: {}, style: {} };
  runInNewContext(initialThemeScript, {
    localStorage: {
      getItem() {
        throw new Error('Storage denied');
      },
    },
    matchMedia: () => ({ matches: true }),
    document: { documentElement: root },
  });
  expect(root.dataset).toEqual({ theme: 'dark' });
});
