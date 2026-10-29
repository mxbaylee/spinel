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
  runner: {
    label: process.env.DESKTOP_RUNNER,
    arch: process.arch,
    imageOS: process.env.ImageOS,
    imageVersion: process.env.ImageVersion,
  },
  run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  status: 'failed',
};

async function command(file: string, args: string[], timeout = 30_000) {
  return (await run(file, args, { timeout, maxBuffer: 1024 * 1024 })).stdout.trim();
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
  const consentScript = `on run argv
  with timeout of 8 seconds
  tell application "System Events"
    if not (exists process "UserNotificationCenter") then return "No permission dialog"
    tell process "UserNotificationCenter"
      if (count of windows) is 0 then return "No permission window"
      set parts to entire contents of front window
      set dialogText to ""
      repeat with part in parts
        if class of part is static text then set dialogText to dialogText & " " & value of part
      end repeat
      if dialogText contains "hosted-compute-agent" and dialogText contains "Safari" and dialogText contains "control" then
        if item 1 of argv is not "approve" then return "Recognized hosted-compute-agent control of Safari: " & dialogText
        repeat with part in parts
          if class of part is button and (name of part is "Allow" or name of part is "OK") then
            click part
            return "Approved hosted-compute-agent control of Safari in the normal ephemeral-runner consent dialog: " & dialogText
          end if
        end repeat
      end if
      return "Unchanged permission dialog: " & dialogText
    end tell
  end tell
  end timeout
  end run`;
  const describe = (error: unknown) => {
    const failure = error as Error & {
      code?: unknown;
      signal?: unknown;
      killed?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    return {
      message: String(failure.message ?? error).split('\n')[0],
      code: failure.code ?? null,
      signal: failure.signal ?? null,
      killed: failure.killed ?? false,
      stdout: String(failure.stdout ?? '').slice(-2000),
      stderr: String(failure.stderr ?? '').slice(-4000),
    };
  };
  type TitleRequest = {
    attempt: number;
    startedAt: string;
    finishedAt?: string;
    value?: string;
    error?: ReturnType<typeof describe>;
  };
  const titleRequests: TitleRequest[] = [];
  const checks: Record<string, unknown>[] = [];
  report.automationTitleRequests = titleRequests;
  report.automationPromptChecks = checks;
  const deadline = Date.now() + 90_000;
  const budget = (maximum: number) => Math.max(1, Math.min(maximum, deadline - Date.now()));
  function titleRequest() {
    const entry: TitleRequest = {
      attempt: titleRequests.length + 1,
      startedAt: new Date().toISOString(),
    };
    titleRequests.push(entry);
    // At most one Safari request is pending while System Events initializes.
    const promise = command(
      '/usr/bin/osascript',
      [
        '-e',
        'on run\nwith timeout of 20 seconds\n tell application "Safari" to return name of front document\nend timeout\nend run',
      ],
      budget(25_000),
    )
      .then(
        (value) => {
          entry.value = value;
        },
        (error) => {
          entry.error = describe(error);
        },
      )
      .finally(() => {
        entry.finishedAt = new Date().toISOString();
      });
    return { entry, promise };
  }
  async function inspect(mode: 'inspect' | 'approve') {
    const entry: Record<string, unknown> = { mode, startedAt: new Date().toISOString() };
    checks.push(entry);
    try {
      const value = await command(
        '/usr/bin/osascript',
        ['-e', consentScript, mode],
        budget(10_000),
      );
      entry.value = value;
      return value;
    } catch (error) {
      entry.error = describe(error);
      return '';
    } finally {
      entry.finishedAt = new Date().toISOString();
    }
  }
  let request = titleRequest();
  let approved = false;
  let captures = 0;
  try {
    while (Date.now() < deadline) {
      // A successful title proves consent is already available, with no extra UI action.
      if (request.entry.value === 'Spinel desktop profile probe') {
        report.automationReadyTitleRequest = request.entry.attempt;
        return;
      }
      if (request.entry.finishedAt) request = titleRequest();
      const observed = await inspect('inspect');
      if (!approved && observed) report.automationPrompt = observed;
      if (observed.startsWith('Recognized hosted-compute-agent control of Safari: ')) {
        const path = resolve(output, `safari-automation-prompt-${++captures}.png`);
        const capture: Record<string, unknown> = {
          mode: 'capture',
          path,
          startedAt: new Date().toISOString(),
        };
        checks.push(capture);
        try {
          await command('/usr/sbin/screencapture', ['-x', path], budget(5000));
          capture.value = 'captured';
        } catch (error) {
          capture.error = describe(error);
        } finally {
          capture.finishedAt = new Date().toISOString();
        }
        if (Date.now() >= deadline) break;
        // Re-read the exact recognized dialog after the screenshot before approval.
        const decision = await inspect('approve');
        if (decision.startsWith('Approved hosted-compute-agent control of Safari ')) {
          approved = true;
          report.automationPrompt = decision;
          if (capture.value === 'captured') report.automationPromptScreenshot = path;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, budget(250)));
    }
    throw new Error(
      'Safari automation consent did not become usable within 90 seconds; all native observations are retained in automationPromptChecks and automationTitleRequests.',
    );
  } finally {
    // Every owned request has its own remaining-deadline timeout; leave none running.
    await request.promise;
    report.firstTitleRequest = titleRequests[0];
  }
}

async function capturePaintBaseline(stage: 'online' | 'offline', pid: unknown) {
  const baseline: Record<string, unknown> = { time: new Date().toISOString(), pid };
  const baselines = (report.paintBaselines ??= {}) as Record<string, unknown>;
  baselines[stage] = baseline;
  try {
    const state = JSON.parse(
      await command(
        '/usr/bin/osascript',
        [
          '-l',
          'JavaScript',
          '-e',
          `function run(argv) {
        var app = Application(Number(argv[0]));
        var window = app.windows[0];
        if (window.miniaturized()) window.miniaturized = false;
        if (!app.frontmost()) app.activate();
        var tab = window.currentTab();
        return JSON.stringify({ windowId: window.id(), bounds: window.bounds(), tabIndex: tab.index(), title: tab.name(), url: tab.url(),
          page: JSON.parse(app.doJavaScript('JSON.stringify({url:location.href,title:document.title,readyState:document.readyState,visibility:document.visibilityState,hasFocus:document.hasFocus(),text:document.body.innerText})', {in:tab})) });
      }`,
          String(pid),
        ],
        5000,
      ),
    );
    baseline.state = state;
    assert.equal(state.title, 'Spinel desktop profile probe');
    const { x, y, width, height } = state.bounds;
    assert.ok([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0);
    const path = resolve(output, `safari-profile-probe-${stage}.png`);
    await command('/usr/sbin/screencapture', ['-x', `-R${x},${y},${width},${height}`, path], 5000);
    baseline.screenshot = path;
  } catch (error) {
    // The capability result still measures the original stores. These captures
    // diagnose whether simple native Safari content paints before app acceptance.
    const detail = error as Error & { code?: unknown; signal?: unknown; stderr?: unknown };
    baseline.error = {
      message: String(error).slice(0, 1000),
      code: detail.code,
      signal: detail.signal,
      stderr: String(detail.stderr ?? '').slice(-2000),
    };
  }
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
    '<!doctype html><html><title>Spinel desktop profile probe</title><style>body{margin:24px;background:white;color:#102a43;font:18px system-ui}h1{font-size:28px}</style><body><h1>Spinel synthetic profile probe</h1><p>Native Safari paint baseline</p><svg width="320" height="120" aria-label="Purple and blue paint baseline"><rect width="160" height="120" fill="#7633d5"/><rect x="160" width="160" height="120" fill="#2563eb"/></svg></body></html>';
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
    report.machine = await command('/usr/bin/uname', ['-m']);
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
    await capturePaintBaseline('online', report.beforePid);
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
    await capturePaintBaseline('offline', report.afterPid);
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
