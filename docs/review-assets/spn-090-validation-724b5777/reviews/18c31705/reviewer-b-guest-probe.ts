import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = '/Users/mxbaylee/projects/spinel-spn-090-current';
const application = readFileSync(root + '/web/application.tsx', 'utf8');
const guest = readFileSync(root + '/web/GuestApp.tsx', 'utf8');
const main = readFileSync(root + '/web/main.tsx', 'utf8');
assert.match(application, /guestItemId\(\) \? <GuestApp \/> : <App \/>/);
assert.doesNotMatch(application + guest, /startupDone/);
assert.match(main, /startupStage\('styles'\)/);
let now = 0;
let tick: (() => void) | undefined;
let cancelled = false;
const lines: any[] = [];
const original = Date.now;
Date.now = () => now;
Object.assign(globalThis, {
  window: {
    setInterval: (fn: () => void) => { tick = fn; return 1; },
    clearInterval: () => { cancelled = true; },
  },
  document: {
    createElement: () => ({ style: {}, setAttribute() {}, remove() {}, textContent: '' }),
    body: { append: (line: any) => lines.push(line) },
  },
});
try {
  const { startupStage, startupDone } = await import(root + '/web/startupStage.ts');
  startupStage('app code');
  startupStage('styles');
  // Guest dispatch has returned, but no GuestApp path calls startupDone.
  now = 9000;
  tick!();
  assert.equal(lines[0].textContent, 'Still starting: styles (9 s)');
  now = 120000;
  tick!();
  assert.equal(lines[0].textContent, 'Still starting: styles (120 s)');
  assert.equal(cancelled, false);
  console.log(JSON.stringify({ kind: 'actual-startup-module + static-guest-dispatch probe', afterGuestBoot: lines[0].textContent, intervalStillActive: !cancelled, nativeBrowserClaim: false }));
  startupDone();
} finally { Date.now = original; }
