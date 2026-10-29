import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const output = resolve('artifacts/desktop-offline');
const report: Record<string, unknown> = {
  scope: 'Native ordinary Safari same-profile capability probe, not application acceptance',
  sourceSha: process.env.SOURCE_SHA,
  testedSha: process.env.GITHUB_SHA,
  run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  status: 'failed',
};

async function command(file: string, args: string[]) {
  return (await run(file, args, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function applescript(source: string, ...args: string[]) {
  return command('/usr/bin/osascript', [
    '-e',
    source.startsWith('on run') ? source : `with timeout of 5 seconds\n${source}\nend timeout`,
    ...args,
  ]);
}

async function evaluate(source: string) {
  return applescript(
    'on run argv\nwith timeout of 5 seconds\n tell application "Safari" to return do JavaScript (item 1 of argv) in front document\nend timeout\nend run',
    source,
  );
}

async function until(check: () => Promise<string>, predicate: (value: string) => boolean) {
  const deadline = Date.now() + 30_000;
  let latest = '';
  while (Date.now() < deadline) {
    try {
      latest = await check();
      if (predicate(latest)) return latest;
    } catch (error) {
      latest = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out: ${latest.slice(0, 1000)}`);
}

async function safariPid() {
  try {
    return await command('/usr/bin/pgrep', ['-x', 'Safari']);
  } catch {
    return '';
  }
}

async function quit() {
  if (!(await safariPid())) return;
  await applescript('tell application "Safari" to quit');
  await until(safariPid, (value) => value === '');
}

async function allowHostedSafariAutomation() {
  // The hosted image grants accessibility, but its Safari Apple Events grant
  // can still present a normal consent dialog. Approve only this disposable
  // runner's exact Safari request through that dialog, never by editing TCC.
  const request = applescript(
    'on run\nwith timeout of 25 seconds\n tell application "Safari" to return name of front document\nend timeout\nend run',
  ).then(
    (value) => ({ value }),
    (error) => ({ error: String(error) }),
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await command('/usr/sbin/screencapture', [
    '-x',
    resolve(output, 'safari-automation-prompt.png'),
  ]).catch(() => {});
  report.automationPrompt = await applescript(`tell application "System Events"
    if not (exists process "UserNotificationCenter") then return "No permission dialog"
    tell process "UserNotificationCenter"
      if (count of windows) is 0 then return "No permission window"
      set parts to entire contents of front window
      set dialogText to ""
      repeat with part in parts
        try
          if class of part is static text then set dialogText to dialogText & " " & value of part
        end try
      end repeat
      if dialogText contains "hosted-compute-agent" and dialogText contains "Safari" and dialogText contains "control" then
        repeat with part in parts
          try
            if class of part is button and (name of part is "Allow" or name of part is "OK") then
              click part
              return "Approved hosted-compute-agent control of Safari in the normal ephemeral-runner consent dialog: " & dialogText
            end if
          end try
        end repeat
      end if
      return "Unchanged permission dialog: " & dialogText
    end tell
  end tell`).catch(String);
  report.firstTitleRequest = await request;
}

async function main() {
  // This configures only an ephemeral hosted CI user's ordinary browser. Never
  // change the owner's Safari settings or interact with their browsing profile.
  assert.equal(process.platform, 'darwin');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  await mkdir(output, { recursive: true });
  const sentinel = randomUUID();
  const html =
    '<!doctype html><html><title>Spinel desktop profile probe</title><body>Spinel synthetic profile probe</body></html>';
  const worker = `self.addEventListener('install', event => event.waitUntil(caches.open('spn052-shell').then(async cache => { await cache.add('/'); await self.skipWaiting(); })));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => { if (event.request.mode === 'navigate') event.respondWith(caches.match('/')); });`;
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Type',
      request.url === '/probe-worker.js' ? 'text/javascript' : 'text/html',
    );
    response.end(request.url === '/probe-worker.js' ? worker : html);
  });
  try {
    report.os = await command('/usr/bin/sw_vers', []);
    report.version = await command('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      '/Applications/Safari.app/Contents/Info.plist',
    ]);
    await quit();
    for (const setting of ['IncludeDevelopMenu', 'AllowJavaScriptFromAppleEvents']) {
      await command('/usr/bin/defaults', ['write', 'com.apple.Safari', setting, '-bool', 'true']);
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(8175, '127.0.0.1', resolve);
    });
    await command('/usr/bin/open', ['-a', 'Safari', 'http://localhost:8175/']);
    report.beforePid = await until(safariPid, Boolean);
    await allowHostedSafariAutomation();
    await until(
      () => applescript('tell application "Safari" to return name of front document'),
      (value) => value === 'Spinel desktop profile probe',
    );
    report.appleEvents = await evaluate('navigator.userAgent');
    await evaluate(`window.__probe = null; (async () => {
      localStorage.setItem('spn052', ${JSON.stringify(sentinel)});
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('spn052-probe', 1); request.onupgradeneeded = () => request.result.createObjectStore('proof'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise((resolve, reject) => { const tx = db.transaction('proof', 'readwrite'); tx.objectStore('proof').put(${JSON.stringify(sentinel)}, 'sentinel'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      db.close();
      await (await caches.open('spn052-proof')).put('/sentinel', new Response(${JSON.stringify(sentinel)}));
      await navigator.serviceWorker.register('/probe-worker.js'); await navigator.serviceWorker.ready;
      window.__probe = JSON.stringify({ prepared: true, persisted: await navigator.storage.persisted(), persistenceRequested: await navigator.storage.persist() });
    })().catch(error => { window.__probe = JSON.stringify({ error: String(error) }); }); void 0;`);
    const prepared = JSON.parse(await until(() => evaluate('window.__probe || ""'), Boolean));
    assert.equal(prepared.prepared, true, JSON.stringify(prepared));
    report.prepared = prepared;
    await until(
      () => evaluate('String(Boolean(navigator.serviceWorker.controller))'),
      (value) => value === 'true',
    );
    await quit();
    // No server is listening when Safari restarts. Reopening may read the
    // retained worker/cache/IDB but must never reconstruct or restore any store.
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    report.requestsBeforeOffline = requests;
    await command('/usr/bin/open', ['-a', 'Safari', 'http://localhost:8175/?offline-restart']);
    report.afterPid = await until(safariPid, Boolean);
    assert.notEqual(report.beforePid, report.afterPid);
    await until(
      () => evaluate('document.title'),
      (value) => value === 'Spinel desktop profile probe',
    );
    await evaluate(`window.__probe = null; (async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('spn052-probe'); request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('missing-original-database')); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const idb = await new Promise((resolve, reject) => { const request = db.transaction('proof', 'readonly').objectStore('proof').get('sentinel'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      db.close();
      const cache = await caches.match('/sentinel');
      window.__probe = JSON.stringify({ localStorage: localStorage.getItem('spn052'), indexedDB: idb, cache: cache ? await cache.text() : null, worker: Boolean(navigator.serviceWorker.controller) });
    })().catch(error => { window.__probe = JSON.stringify({ error: String(error) }); }); void 0;`);
    const retained = JSON.parse(await until(() => evaluate('window.__probe || ""'), Boolean));
    assert.deepEqual(retained, {
      localStorage: sentinel,
      indexedDB: sentinel,
      cache: sentinel,
      worker: true,
    });
    assert.equal(requests, report.requestsBeforeOffline);
    report.retained = retained;
    report.status = 'passed';
  } catch (error) {
    report.error = String(error).slice(0, 2000);
    if (error && typeof error === 'object') {
      const detail = error as {
        code?: unknown;
        signal?: unknown;
        killed?: unknown;
        stderr?: unknown;
      };
      report.errorDetail = {
        code: detail.code,
        signal: detail.signal,
        killed: detail.killed,
        stderr: detail.stderr,
      };
    }
    await command('/usr/sbin/screencapture', [
      '-x',
      resolve(output, 'safari-capability-failure.png'),
    ]).catch(() => {});
    report.processes = await command('/bin/ps', ['-axo', 'pid,ppid,comm'])
      .then((text) =>
        text.split('\n').filter((line) => /Safari|osascript|node|bash|tccd/.test(line)),
      )
      .catch(String);
    report.automationLog = await command('/usr/bin/log', [
      'show',
      '--last',
      '2m',
      '--style',
      'compact',
      '--predicate',
      'subsystem == "com.apple.TCC"',
    ])
      .then((text) =>
        text
          .split('\n')
          .filter((line) => /AUTHREQ|PROMPT|Safari|osascript/.test(line))
          .slice(-60),
      )
      .catch(String);
    process.exitCode = 1;
  } finally {
    await quit().catch((error) => {
      report.teardownError = String(error);
      process.exitCode = 1;
    });
    server.close();
    await writeFile(
      resolve(output, 'safari-profile-probe.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report, null, 2));
  }
}

await main();
