import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Published @univerjs/core@1.1.0 package bytes. SPN-099 qualifies application
// integration against this stock release; no installer rewrites either build.
// A future coordinated SDK upgrade must qualify its published bytes and native
// regressions together. This is a verification check, not an install-time repair.
const official = {
  es: 'ecbebddd3821c5603d41fb7febf5277ca051171caa170d0c51afe12143cedc12',
  cjs: 'abbf88dcec149753c405c6a7243a3ea5267df31e56849ba4cde6bc839512d829',
};

for (const [format, expected] of Object.entries(official))
  test(`installed Univer core ${format} is the unchanged published release`, async () => {
    const bytes = await readFile(
      new URL(`../../node_modules/@univerjs/core/lib/${format}/index.js`, import.meta.url),
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  });
