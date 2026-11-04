import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type SafariTarget = {
  pid: number;
  bundleIdentifier: string;
  executablePath: string;
  launchedAt: number;
};

// Address the observed process, not a Launch Services name lookup after an
// update. This removes ambiguity; it does not establish why Intel name-based
// Apple Events timed out, and it does not bypass normal automation consent.
export const safariRequestScript = String.raw`
function phase(name) { console.log('Safari request phase: ' + JSON.stringify({ at: new Date().toISOString(), phase: name })); }
// Foundation is available by default. Retain the bundle for this helper's
// lifetime while using its executable's class, without importing AppKit symbols.
phase('appkit-bundle-create-begin');
var appkitBundle = $.NSBundle.bundleWithPath('/System/Library/Frameworks/AppKit.framework');
if (appkitBundle.isNil()) throw new Error('The system AppKit bundle is unavailable.');
phase('appkit-bundle-create-end');
phase('appkit-executable-load-begin');
if (!appkitBundle.load) throw new Error('The system AppKit executable could not be loaded.');
phase('appkit-executable-load-end');
phase('running-application-class-begin');
var runningApplication = $.NSClassFromString($('NSRunningApplication'));
if (runningApplication.isNil()) throw new Error('The NSRunningApplication class is unavailable.');
phase('running-application-class-end');
function readIdentity(pid, launchedAt, executablePath) {
  phase('process-lookup-begin');
  var running = runningApplication.runningApplicationWithProcessIdentifier(pid);
  phase('process-lookup-end');
  phase('process-liveness-begin');
  if (running.isNil() || running.terminated) throw new Error('The observed Safari process exited.');
  phase('process-liveness-end');
  var identity = {};
  phase('pid-read-begin');
  identity.pid = running.processIdentifier;
  phase('pid-read-end');
  phase('bundle-read-begin');
  identity.bundleIdentifier = ObjC.unwrap(running.bundleIdentifier);
  phase('bundle-read-end');
  phase('executable-read-begin');
  identity.executablePath = ObjC.unwrap(running.executableURL.path);
  phase('executable-read-end');
  phase('launch-date-read-begin');
  identity.launchedAt = running.launchDate.timeIntervalSince1970;
  phase('launch-date-read-end');
  phase('identity-validation-begin');
  if (identity.pid !== pid || identity.bundleIdentifier !== 'com.apple.Safari' || !Number.isFinite(identity.launchedAt) || identity.launchedAt <= 0)
    throw new Error('The observed PID is not the expected Safari process: ' + JSON.stringify(identity));
  if (launchedAt && identity.launchedAt !== Number(launchedAt))
    throw new Error('The observed Safari PID has been reused: ' + JSON.stringify(identity));
  if (typeof identity.executablePath !== 'string' || identity.executablePath.charAt(0) !== '/' ||
      (executablePath && identity.executablePath !== executablePath))
    throw new Error('The observed Safari executable changed: ' + JSON.stringify(identity));
  phase('identity-validation-end');
  return identity;
}
function run(argv) {
  var pid = Number(argv[0]);
  var identity = readIdentity(pid, argv[1], argv[5]);
  if (argv[2] === 'identify') return JSON.stringify(identity);
  console.log('Safari request target: ' + JSON.stringify(identity));
  phase('application-constructor-begin');
  var app;
  try {
    app = Application(pid);
  } catch (first) {
    console.log('Safari constructor failure: ' + JSON.stringify({ attempt: 1, errorNumber: first.errorNumber, message: String(first) }));
    // Only this constructor has run: no property read or requested action has
    // been dispatched. Do not recover errors from any subsequent command.
    if (first.errorNumber !== -2700 || first.message !== "Application can't be found.") throw first;
    try {
      phase('constructor-revalidation-begin');
      readIdentity(pid, identity.launchedAt, identity.executablePath);
      phase('constructor-revalidation-end');
      phase('application-constructor-second-begin');
      app = Application(pid);
      phase('application-constructor-second-end');
    } catch (second) {
      console.log('Safari constructor recovery failure: ' + JSON.stringify({ errorNumber: second.errorNumber, message: String(second) }));
      throw first;
    }
  }
  phase('application-constructor-end');
  // Resolution is not authority to address a replacement process.
  readIdentity(pid, identity.launchedAt, identity.executablePath);
  phase('action-dispatch-begin');
  var seconds = Number(argv[4]);
  if (argv[2] === 'title') {
    var name = app.documents[0].name;
    phase('title-specifier-ready');
    phase('title-get-begin');
    var title = name({ timeout: seconds });
    phase('title-get-end');
    return title;
  }
  if (argv[2] === 'evaluate') return app.doJavaScript(argv[3], { in: app.documents[0] }, { timeout: seconds });
  if (argv[2] === 'quit') { app.quit(); return 'Quit requested'; }
  if (argv[2] === 'baseline') {
    var window = app.windows[0];
    if (window.miniaturized()) window.miniaturized = false;
    if (!app.frontmost()) app.activate();
    var tab = window.currentTab();
    return JSON.stringify({ windowId: window.id(), bounds: window.bounds(), tabIndex: tab.index(), title: tab.name(), url: tab.url(),
      page: JSON.parse(app.doJavaScript('JSON.stringify({url:location.href,title:document.title,readyState:document.readyState,visibility:document.visibilityState,hasFocus:document.hasFocus(),text:document.body.innerText})', {in:tab})) });
  }
  throw new Error('Unknown Safari request.');
}`;

const run = promisify(execFile);

export async function waitForSafariValue(
  check: () => Promise<string>,
  predicate: (value: string) => boolean,
) {
  const deadline = Date.now() + 30_000;
  let latest = '';
  while (Date.now() < deadline) {
    // Only successful values may be polled. Identity, consent, dispatch and
    // host-process failures remain fatal at the actual caller boundary.
    latest = await check();
    if (predicate(latest)) return latest;
    await delay(250);
  }
  throw new Error(`Timed out: ${latest.slice(0, 1000)}`);
}

function describeRequestFailure(error: unknown) {
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
    stdout: String(failure.stdout ?? ''),
    stderr: String(failure.stderr ?? ''),
  };
}

/** Observe the one pending title while the normal consent UI is serviced. */
export function observeSafariTitle(work: Promise<string>, entry: Record<string, unknown>) {
  let failed = false;
  let failure: unknown;
  const promise = work
    .then(
      (value) => {
        entry.value = value;
      },
      (error) => {
        failed = true;
        failure = error;
        entry.error = describeRequestFailure(error);
      },
    )
    .finally(() => {
      entry.finishedAt = new Date().toISOString();
    });
  return {
    promise,
    value() {
      if (failed) throw failure;
      return entry.value;
    },
  };
}

/** The required native helper is distinct from optional screenshot/readback diagnostics. */
export async function readSafariBaseline(
  read: () => Promise<string>,
  entry: Record<string, unknown>,
) {
  try {
    const state = JSON.parse(await read()) as {
      title: string;
      bounds: { x: number; y: number; width: number; height: number };
    };
    assert.equal(state.title, 'Spinel desktop profile probe');
    const { x, y, width, height } = state.bounds;
    assert.ok([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0);
    entry.state = state;
    return state;
  } catch (error) {
    entry.error = describeRequestFailure(error);
    throw error;
  }
}

export async function requestSafari(
  target: SafariTarget,
  mode: 'title' | 'evaluate' | 'quit' | 'baseline',
  source: string,
  timeout: number,
  entry: Record<string, unknown>,
  execute: (
    file: string,
    args: readonly string[],
    options: { timeout: number; maxBuffer: number; encoding: 'utf8' },
  ) => Promise<{ stdout: string; stderr: string }> = run,
) {
  Object.assign(entry, {
    mode,
    target,
    timeoutMs: timeout,
    startedAt: new Date().toISOString(),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
  });
  const started = performance.now();
  try {
    const { stdout, stderr } = await execute(
      '/usr/bin/osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        safariRequestScript,
        String(target.pid),
        String(target.launchedAt),
        mode,
        source,
        String(Math.max(1, Math.floor(timeout / 1000))),
        target.executablePath,
      ],
      { timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    );
    entry.trace = stderr;
    entry.status = 'passed';
    return stdout.trim();
  } catch (error) {
    const detail = error as Error & {
      code?: unknown;
      signal?: unknown;
      killed?: unknown;
      stderr?: unknown;
    };
    entry.status = 'failed';
    entry.trace = String(detail.stderr ?? '');
    entry.error = {
      message: String(error).split('\n')[0],
      code: detail.code,
      signal: detail.signal,
      killed: detail.killed,
    };
    throw error;
  } finally {
    entry.elapsedMs = Math.round(performance.now() - started);
  }
}

// Keep the original deadline, and retain stderr on success as well as failure.
export async function identifySafari(
  pid: string,
  entry: Record<string, unknown>,
  execute: (
    file: string,
    args: readonly string[],
    options: { timeout: number; maxBuffer: number; encoding: 'utf8' },
  ) => Promise<{ stdout: string; stderr: string }> = run,
): Promise<SafariTarget> {
  assert.match(pid, /^[1-9]\d*$/);
  entry.phase = 'osascript-startup';
  entry.timeoutMs = 8000;
  const started = performance.now();
  const trace = (stderr: string) => {
    entry.trace = stderr.slice(-8000);
    const phases = [...stderr.matchAll(/Safari request phase: (\{[^\n]+\})/g)];
    if (phases.length) {
      try {
        entry.phase = JSON.parse(phases.at(-1)![1]).phase;
      } catch (error) {
        entry.traceError = String(error);
      }
    }
  };
  try {
    const { stdout, stderr } = await execute(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', safariRequestScript, pid, '', 'identify', '', '5'],
      { timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    );
    trace(String(stderr));
    entry.stdout = String(stdout).slice(-2000);
    entry.phase = 'host-identity-parse';
    const identity = JSON.parse(String(stdout)) as SafariTarget;
    entry.phase = 'host-identity-validation';
    assert.equal(identity.pid, Number(pid));
    assert.equal(identity.bundleIdentifier, 'com.apple.Safari');
    assert.ok(identity.executablePath?.startsWith('/'));
    assert.ok(Number.isFinite(identity.launchedAt) && identity.launchedAt > 0);
    entry.identity = identity;
    entry.phase = 'identity-established';
    return identity;
  } catch (error) {
    const detail = error as Error & {
      code?: unknown;
      signal?: unknown;
      killed?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    if (detail.stderr !== undefined) trace(String(detail.stderr));
    entry.error = {
      message: String(error).split('\n')[0],
      code: detail.code,
      signal: detail.signal,
      killed: detail.killed,
      stdout: String(detail.stdout ?? '').slice(-2000),
      stderr: String(detail.stderr ?? '').slice(-8000),
    };
    throw error;
  } finally {
    entry.elapsedMs = Math.round(performance.now() - started);
  }
}
