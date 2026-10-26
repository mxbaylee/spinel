import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { retainPdf } from './native-test-support.ts';

test('the one public entry keeps metadata native-free and first rendering owns inputs before yielding', async () => {
  const directory = resolve('output/pdf/spn-102');
  const completion = resolve(directory, 'entry-result.json');
  await rm(completion, { force: true });
  await promisify(execFile)(
    process.execPath,
    [fileURLToPath(new URL('./entry-fixture.ts', import.meta.url)), directory],
    {
      env: { DISABLE_SYSTEM_FONTS_LOAD: '1', LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production' },
      timeout: 30_000,
      maxBuffer: 65_536,
    },
  );
  expect(JSON.parse(await readFile(completion, 'utf8'))).toEqual({
    pureMetadata: true,
    overlapCode: 'limit',
    docPages: 1,
    sheetPages: 1,
    remainingFonts: 0,
  });
  for (const [kind, original, changed] of [
    ['doc', 'ORIGINAL-DOC', 'MUTATED-DOC'],
    ['sheet', 'ORIGINAL-SHEET', 'MUTATED-SHEET'],
  ]) {
    const name = `entry-owned-${kind}`;
    const pages = await retainPdf(
      name,
      await readFile(resolve(directory, `${name}.pdf`)),
      directory,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain(original);
    expect(pages[0].text).not.toContain(changed);
  }
}, 40_000);
