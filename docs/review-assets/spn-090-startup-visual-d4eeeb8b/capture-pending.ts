import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = '/tmp/spn090-startup-hosted';
const source = 'd4eeeb8b4871695a0efc9b2c09259cc801784894';
const zip = base + '/story-build.zip';
const digest = createHash('sha256');
for await (const chunk of createReadStream(zip)) digest.update(chunk);
assert.equal(digest.digest('hex'), 'f3a3466d9c890f0593500ea028d25dfee24aefe595965c3619fb06778cd91feb');
const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
assert.ok(names.every(n => !n.startsWith('/') && !n.split('/').includes('..')));
const root = base + '/storybook-static';
mkdirSync(root, { recursive: true });
execFileSync('unzip', ['-qo', zip, '-d', root]);
const identity = JSON.parse(readFileSync(root + '/sha.json', 'utf8'));
assert.equal(identity.sha, source);
assert.equal(identity.checkedOutSha, '1ac497cddf189165a95d2de5e5875e114fe452e3');
const require = createRequire('/Users/mxbaylee/projects/spinel-spn-090-production/package.json');
const { preview } = require('vite');
const { chromium, expect } = require('@playwright/test');
const output = base + '/visual/pending-result';
mkdirSync(output, { recursive: true });
const receipt: any = { identity, artifact: 13435559182, source, fixture: 'production OfflineAvailability component with synthetic ProtectionPending story data', fixtureTime: '2026-10-20T16:00:00Z', browserExecutable: chromium.executablePath(), captures: [], browserClosed: false, serverClosed: false };
const server = await preview({ configFile: false, root, build: { outDir: '.' }, preview: { host: '127.0.0.1', port: 6019, strictPort: true } });
let browser: any;
try {
  browser = await chromium.launch();
  receipt.browserVersion = browser.version();
  for (const [theme, width, label] of [['light', 1280, 'light'], ['dark', 1280, 'dark'], ['light', 390, 'phone']] as const) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, hasTouch: width === 390, reducedMotion: 'reduce', colorScheme: theme });
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    try {
      await page.clock.setSystemTime(new Date(receipt.fixtureTime));
      const id = 'offline-availability--protection-pending';
      await page.goto(`http://127.0.0.1:6019/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`, { timeout: 10000 });
      await page.waitForFunction((id: string) => (window as any).__STORYBOOK_PREVIEW__?.currentRender?.phase === 'finished' && (window as any).__STORYBOOK_PREVIEW__?.channel?.last('storyFinished')?.[0]?.storyId === id, id, { timeout: 10000 });
      const result = await page.evaluate(() => { const p = (window as any).__STORYBOOK_PREVIEW__; return { story: p.channel.last('storyFinished')[0], errors: ['playFunctionThrewException', 'unhandledErrorsWhilePlaying'].flatMap(e => p.channel.last(e) ?? []) }; });
      assert.equal(result.story.status, 'success'); assert.deepEqual(result.errors, []);
      await expect(page.getByRole('dialog', { name: 'About device storage', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'About device storage', exact: true })).toHaveCount(0);
      const dialog = page.getByRole('dialog', { name: 'Offline availability', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/still deciding on storage protection/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'How to keep them' })).toBeFocused();
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(errors, []);
      const file = `storage-pending-${label}.png`;
      await page.screenshot({ path: output + '/' + file });
      receipt.captures.push({ file, theme, width, height: 900, story: id, state: 'pending result after ordinary Escape from storage guidance; focus restored', sha256: createHash('sha256').update(readFileSync(output + '/' + file)).digest('hex') });
    } finally { await page.close(); }
  }
} finally {
  if (browser) { await browser.close(); receipt.browserClosed = true; }
  await new Promise<void>((resolve, reject) => server.httpServer.close((e: Error | undefined) => e ? reject(e) : resolve()));
  receipt.serverClosed = true;
  writeFileSync(output + '/receipt.json', JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify(receipt));
