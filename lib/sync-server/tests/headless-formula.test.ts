import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('headless retained IMAGE formulas and later edits never start browser calculation', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--unhandled-rejections=strict',
      fileURLToPath(new URL('./headless-formula.fixture.ts', import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(output).toBe('headless authored formulas preserved\n');
});
