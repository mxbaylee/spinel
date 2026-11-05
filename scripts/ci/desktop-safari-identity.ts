import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
// Foundation is available by default. Load the public system image directly;
// keep its opaque handle until this short-lived helper exits so its classes
// remain available. Do not apply Objective-C pointer methods or unload it.
phase('appkit-loader-bind-begin');
ObjC.bindFunction('dlopen', ['void*', ['char*', 'int']]);
ObjC.bindFunction('dlerror', ['void*', []]);
var openImage = $.dlopen;
var imageError = $.dlerror;
var samePointer = Ref.equals;
phase('appkit-loader-bind-end');
phase('appkit-executable-load-begin');
// dlerror's second consecutive read is contractually NULL. JXA wraps even NULL
// C pointers in truthy Ref objects; string conversion would throw. Compare only
// opaque pointer identity, without dereferencing or casting an address.
imageError();
var noError = imageError();
var appkitHandle = openImage('/System/Library/Frameworks/AppKit.framework/AppKit', 1);
var appkitLoadError = imageError();
if (!samePointer(appkitLoadError, noError))
  throw new Error('The system AppKit executable could not be loaded.');
if (samePointer(appkitHandle, noError)) throw new Error('The system AppKit loader returned no handle.');
phase('appkit-executable-load-end');
phase('running-application-class-begin');
var runningApplication = $.NSClassFromString($('NSRunningApplication'));
if (runningApplication.isNil()) throw new Error('The NSRunningApplication class is unavailable.');
phase('running-application-class-end');
function run(argv) {
  var pid = Number(argv[0]);
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
  if (argv[1] && identity.launchedAt !== Number(argv[1]))
    throw new Error('The observed Safari PID has been reused: ' + JSON.stringify(identity));
  phase('identity-validation-end');
  if (argv[2] === 'identify') return JSON.stringify(identity);
  console.log('Safari request target: ' + JSON.stringify(identity));
  phase('application-constructor-begin');
  var app = Application(pid);
  phase('application-constructor-end');
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
