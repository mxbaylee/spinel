import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, open, realpath, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

export type DesktopBrowserKind = 'chrome' | 'firefox' | 'safari';
export type DesktopKey = 'Enter' | 'Escape' | 'DocumentStart' | 'SelectAll' | 'Copy' | 'Space';
type ObjectValue = Record<string, unknown>;
type ProfileIdentity = {
  mode: 'explicit-directory' | 'ordinary-hosted-safari-user';
  requestedPath: string;
  actualPath: string;
  directoryDevice: string;
  directoryInode: string;
};
export type DesktopBrowserStart = {
  kind: DesktopBrowserKind;
  version: string;
  userAgent: string;
  profile: ProfileIdentity;
  browserPid: number;
  previousBrowserPid: number | null;
  driverPid: number | null;
  driverVersion: string | null;
  startedAt: string;
};
export type DesktopBrowserStop = {
  kind: DesktopBrowserKind;
  browserPid: number | null;
  driverPid: number | null;
  browserExited: boolean | null;
  driverExited: boolean;
  stoppedAt: string;
};
export type DesktopStoragePrompt = {
  action: 'allow' | 'none';
  observedText: string | null;
  button: 'Allow' | null;
  reason: string;
  screenshot?: string;
  accessibility?: string;
  process?: { pid: number; name: string; bundleIdentifier: string };
};
export type DesktopBrowser = {
  start(url: string): Promise<DesktopBrowserStart>;
  goto(url: string): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  focus(selector: string): Promise<void>;
  press(key: DesktopKey): Promise<void>;
  type(text: string): Promise<void>;
  click(selector: string, index?: number): Promise<void>;
  clickAt(selector: string, x: number, y: number): Promise<void>;
  resolveStoragePrompt(): Promise<DesktopStoragePrompt>;
  screenshot(path: string, scope?: 'content' | 'screen'): Promise<void>;
  stop(): Promise<DesktopBrowserStop>;
};

const run = promisify(execFile);
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const binaries = {
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  firefox: '/Applications/Firefox.app/Contents/MacOS/firefox',
};
const keyValues: Record<DesktopKey, string> = {
  Enter: '\uE007',
  Escape: '\uE00C',
  DocumentStart: '\uE013',
  SelectAll: 'a',
  Copy: 'c',
  Space: '\uE00D',
};

function object(value: unknown): ObjectValue {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as ObjectValue;
}
async function command(file: string, args: string[], timeout = 30_000) {
  try {
    return (await run(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  } catch (error) {
    const failure = error as Error & {
      code?: string | number;
      signal?: string | null;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    const details = {
      program: file,
      code: failure.code ?? null,
      signal: failure.signal ?? null,
      killed: failure.killed ?? false,
      timeoutMs: timeout,
      stdout: String(failure.stdout ?? '').slice(-2000),
      stderr: String(failure.stderr ?? '').slice(-8000),
    };
    // Keep code available to the deliberate ps/pgrep "process absent" checks.
    throw Object.assign(
      new Error(`Native command failed: ${JSON.stringify(details)}`, { cause: error }),
      {
        code: failure.code,
        signal: failure.signal,
        killed: failure.killed,
        stdout: failure.stdout,
        stderr: failure.stderr,
      },
    );
  }
}
async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 30_000;
  let last: unknown;
  do {
    try {
      const value = await read();
      if (accept(value)) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${String(last).slice(0, 1000)}`);
}
async function processIdentity(pid: number) {
  try {
    return await command('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], 5000);
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return '';
    throw error;
  }
}
async function freePort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function driverPath(kind: 'chrome' | 'firefox') {
  const name = kind === 'chrome' ? 'chromedriver' : 'geckodriver';
  const configured = process.env[kind === 'chrome' ? 'CHROMEWEBDRIVER' : 'GECKOWEBDRIVER'];
  const candidates = [
    ...(configured ? [configured, join(configured, name)] : []),
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((entry) => join(entry, name)),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Only the runner's installed drivers are candidates; do not download a substitute.
    }
  }
  throw new Error(`The runner has no installed ${name}.`);
}
async function safariPid() {
  try {
    const value = await command('/usr/bin/pgrep', ['-x', 'Safari'], 5000);
    assert.match(value, /^\d+$/, 'Expected one ordinary Safari process.');
    return Number(value);
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}
const applescript = (source: string, ...args: string[]) =>
  command('/usr/bin/osascript', ['-e', source, ...args]);
const safariScript = (expression: string) =>
  applescript(
    'on run argv\n tell application "Safari" to return do JavaScript (item 1 of argv) in front document\nend run',
    expression,
  );

// Inspect browser chrome through macOS accessibility, excluding website content.
// Approval re-runs the same inspection and matches the question captured before it.
const firefoxStoragePromptScript = String.raw`
function run(argv) {
  var system = Application('System Events');
  var processes = system.applicationProcesses.whose({ unixId: Number(argv[0]) })();
  if (processes.length !== 1) throw new Error('The owned Firefox process is unavailable.');
  var process = processes[0];
  var identity = { pid: process.unixId(), name: process.name(), bundleIdentifier: process.bundleIdentifier() };
  console.log('firefox identity: ' + JSON.stringify(identity));
  if (identity.pid !== Number(argv[0]) || identity.bundleIdentifier !== 'org.mozilla.firefox')
    throw new Error('The owned process is not the expected Firefox bundle: ' + JSON.stringify(identity));
  process.frontmost = true;
  var nodes = [], candidates = [], allButtons = [], truncated = false;
  var question = /\b(?:will you allow|allow) (?:https:\/\/)?localhost(?::8176)? to store data (?:in persistent storage|on your computer)\?/i;
  function text(value) {
    return typeof value === 'string' ? value.replace(/[\u200e\u200f\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim() : '';
  }
  function visit(element, path, depth) {
    if (nodes.length >= 500 || depth > 18) { truncated = true; return { texts: [], buttons: [] }; }
    var p = element.properties();
    var role = text(p.role);
    if (role === 'AXWebArea') return { texts: [], buttons: [] };
    var own = [p.name, p.description, p.value].map(text).filter(function(value, index, values) { return value && values.indexOf(value) === index; });
    var node = { path: path, role: role, subrole: text(p.subrole), text: own, enabled: p.enabled, position: p.position, size: p.size };
    nodes.push(node);
    var result = { texts: own.slice(), buttons: [] };
    if (role === 'AXButton' || role === 'AXPopUpButton') {
      var button = { element: element, labels: own, enabled: p.enabled === true, size: p.size };
      result.buttons.push(button);
      allButtons.push(button);
    }
    element.uiElements().forEach(function(child, index) {
      var nested = visit(child, path.concat(index), depth + 1);
      result.texts = result.texts.concat(nested.texts);
      result.buttons = result.buttons.concat(nested.buttons);
    });
    var matched = result.texts.join(' ').match(question);
    var allow = result.buttons.filter(function(button) { return button.labels.indexOf('Allow') !== -1 && Array.isArray(button.size) && button.size[0] > 0 && button.size[1] > 0; });
    var block = result.buttons.filter(function(button) { return button.labels.indexOf('Block') !== -1; });
    if (matched && allow.length === 1 && block.length === 1)
      candidates.push({ path: path, prompt: matched[0], button: allow[0] });
    return result;
  }
  process.windows().forEach(function(window, index) { visit(window, [index], 0); });
  if (truncated) throw new Error('Firefox accessibility inspection exceeded its bound.');
  // Only the smallest matching container represents the observed prompt.
  candidates = candidates.filter(function(candidate) {
    return !candidates.some(function(other) { return other.path.length > candidate.path.length && candidate.path.every(function(index, part) { return other.path[part] === index; }); });
  });
  var promptLike = allButtons.some(function(button) { return button.labels.some(function(label) { return /^(Allow|Block|Don't Allow|Not Now)$/.test(label); }); }) || nodes.some(function(node) { return /AX(Dialog|Sheet|Popover)/.test(node.role + ' ' + node.subrole); });
  var knownQuestion = nodes.map(function(node) { return node.text.join(' '); }).join(' ').match(question);
  var status = candidates.length === 1 ? (candidates[0].button.enabled ? 'recognized' : 'pending') : knownQuestion ? 'pending' : promptLike ? 'unrecognized' : 'none';
  var result = { status: status, action: 'none', process: identity, observedText: candidates.length === 1 ? candidates[0].prompt : knownQuestion ? knownQuestion[0] : null, nodes: nodes };
  if (argv[1] === 'allow') {
    if (result.status !== 'recognized' || result.observedText !== argv[2]) throw new Error('The observed localhost storage prompt changed before approval.');
    system.click(candidates[0].button.element);
    result.action = 'allow';
  }
  return JSON.stringify(result);
}`;

/** Native macOS browsers with real, retained profiles. No storage export/import or policy overrides. */
export function createDesktopBrowser(
  kind: DesktopBrowserKind,
  profile: string,
  outputDir: string,
): DesktopBrowser {
  const requestedPath = resolve(profile);
  let driver: ChildProcess | null = null;
  let endpoint = '';
  let sessionId = '';
  let browserPid: number | null = null;
  let browserIdentity = '';
  let previousBrowserPid: number | null = null;
  let launches = 0;
  let storagePrompts = 0;
  let spawnError: Error | undefined;

  async function request(path: string, method = 'GET', body?: unknown, timeout = 35_000) {
    if (spawnError) throw spawnError;
    if (body !== undefined) assert.notEqual(method, 'GET');
    const response = await fetch(`${endpoint}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
    const result = object(await response.json());
    const value = result.value;
    if (!response.ok || (value && typeof value === 'object' && 'error' in value)) {
      throw new Error(`WebDriver ${method} ${path}: ${JSON.stringify(value).slice(0, 1500)}`);
    }
    return value;
  }
  const session = (path: string, method = 'GET', body?: unknown) => {
    assert.ok(sessionId, 'The browser has no active WebDriver session.');
    return request(`session/${sessionId}/${path}`, method, body);
  };
  async function captureScreen(path: string) {
    assert.ok(browserPid, 'Start the browser before capturing it.');
    await mkdir(dirname(resolve(path)), { recursive: true });
    await command('/usr/sbin/screencapture', ['-x', '-m', resolve(path)], 10_000);
  }
  async function resolveStoragePrompt(): Promise<DesktopStoragePrompt> {
    assert.ok(browserPid, 'Start the browser before inspecting permissions.');
    if (kind !== 'firefox')
      return { action: 'none', observedText: null, button: null, reason: 'not-firefox' };
    type Inspection = {
      status: 'recognized' | 'pending' | 'unrecognized' | 'none';
      action: 'allow' | 'none';
      observedText: string | null;
      process: NonNullable<DesktopStoragePrompt['process']>;
      nodes: unknown[];
    };
    const inspect = async (action = 'inspect', expected = '') =>
      JSON.parse(
        await command(
          '/usr/bin/osascript',
          [
            '-l',
            'JavaScript',
            '-e',
            firefoxStoragePromptScript,
            String(browserPid),
            action,
            expected,
          ],
          10_000,
        ),
      ) as Inspection;
    let last: Inspection | undefined;
    let evidence: { screenshot: string; accessibility: string } | undefined;
    async function capture(error?: unknown) {
      const stem = resolve(outputDir, `firefox-storage-prompt-${++storagePrompts}`);
      evidence = { screenshot: `${stem}.png`, accessibility: `${stem}.json` };
      await mkdir(outputDir, { recursive: true });
      await writeFile(
        evidence.accessibility,
        JSON.stringify(
          { inspection: last, error: error === undefined ? undefined : String(error) },
          null,
          2,
        ) + '\n',
      );
      await captureScreen(evidence.screenshot);
      return evidence;
    }
    try {
      const deadline = Date.now() + 10_000;
      do {
        const complete = await evaluate<boolean>(
          `Array.from(document.querySelectorAll('[role="dialog"]')).some(dialog => dialog.getClientRects().length && dialog.textContent.includes('Offline availability') && Array.from(dialog.querySelectorAll('button')).some(button => button.textContent.trim() === 'Done'))`,
        );
        if (complete)
          return {
            action: 'none',
            observedText: null,
            button: null,
            reason: 'production-result-already-visible',
          };
        last = await inspect();
        if (last.status === 'recognized') {
          await capture();
          const approved = await inspect('allow', last.observedText!);
          assert.equal(approved.action, 'allow');
          return {
            action: 'allow',
            observedText: approved.observedText,
            button: 'Allow',
            reason: 'observed-localhost-storage-permission',
            process: approved.process,
            ...evidence,
          };
        }
        assert.notEqual(
          last.status,
          'unrecognized',
          'An unrecognized native Firefox permission prompt was left untouched.',
        );
        await delay(500);
      } while (Date.now() < deadline);
      assert.notEqual(
        last?.status,
        'pending',
        'The observed storage prompt did not enable its Allow action.',
      );
      await capture();
      return {
        action: 'none',
        observedText: null,
        button: null,
        reason: 'no-native-storage-prompt-observed',
        process: last?.process,
        ...evidence,
      };
    } catch (error) {
      if (!evidence) await capture(error);
      throw new Error(
        `Firefox storage permission was not approved: ${String(error)}. Native evidence: ${evidence?.accessibility}; ${evidence?.screenshot}`,
        { cause: error },
      );
    }
  }
  async function evaluate<T>(expression: string): Promise<T> {
    assert.ok(browserPid, 'Start the browser before evaluating a page.');
    let result: ObjectValue;
    if (kind === 'safari') {
      // Apple Events cannot return promises. This temporary page-only slot does
      // not touch localStorage, IndexedDB, CacheStorage or the native document.
      const slot = `__spinelDesktop_${randomUUID().replaceAll('-', '')}`;
      const key = JSON.stringify(slot);
      await safariScript(
        `globalThis[${key}] = ''; Promise.resolve().then(() => (${expression})).then(value => { globalThis[${key}] = JSON.stringify({ ok: true, value: value === undefined ? null : value }); }).catch(error => { globalThis[${key}] = JSON.stringify({ ok: false, error: String(error) }); }); void 0;`,
      );
      try {
        const raw = await poll(
          () => safariScript(`globalThis[${key}] || ''`),
          Boolean,
          'Safari evaluation timed out',
        );
        result = object(JSON.parse(raw));
      } finally {
        await safariScript(`delete globalThis[${key}]; void 0;`);
      }
    } else {
      result = object(
        await session('execute/async', 'POST', {
          script: `const done = arguments[arguments.length - 1]; Promise.resolve().then(() => (${expression})).then(value => done({ ok: true, value: value === undefined ? null : value }), error => done({ ok: false, error: String(error) }));`,
          args: [],
        }),
      );
    }
    assert.equal(result.ok, true, String(result.error));
    return result.value as T;
  }
  async function focusAt(selector: string, index: number) {
    assert.ok(Number.isSafeInteger(index) && index >= 0);
    await evaluate(`(() => {
      const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!(element instanceof HTMLElement) || !element.getClientRects().length || element.matches(':disabled, [aria-disabled="true"]')) throw new Error('The target is not an enabled visible element.');
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      element.focus({ preventScroll: true });
      if (document.activeElement !== element && !element.contains(document.activeElement)) throw new Error('The target could not receive keyboard focus.');
    })()`);
  }
  async function press(key: DesktopKey) {
    assert.ok(browserPid, 'Start the browser before sending input.');
    const commandKey = key === 'SelectAll' || key === 'Copy' || key === 'DocumentStart';
    if (kind === 'safari') {
      const code = { Enter: 36, Escape: 53, DocumentStart: 126, Space: 49 };
      await applescript(
        key === 'SelectAll' || key === 'Copy'
          ? `tell application "Safari" to activate\ntell application "System Events" to keystroke "${keyValues[key]}" using command down`
          : `tell application "Safari" to activate\ntell application "System Events" to key code ${code[key]}${commandKey ? ' using command down' : ''}`,
      );
      return;
    }
    const actions = [
      ...(commandKey ? [{ type: 'keyDown', value: '\uE03D' }] : []),
      { type: 'keyDown', value: keyValues[key] },
      { type: 'keyUp', value: keyValues[key] },
      ...(commandKey ? [{ type: 'keyUp', value: '\uE03D' }] : []),
    ];
    try {
      await session('actions', 'POST', {
        actions: [{ type: 'key', id: 'desktop-input', actions }],
      });
    } finally {
      await session('actions', 'DELETE');
    }
  }
  async function clickAt(selector: string, x: number, y: number) {
    assert.ok(browserPid, 'Start the browser before sending pointer input.');
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0);
    if (kind === 'safari') await applescript('tell application "Safari" to activate');
    const point = await evaluate<{ x: number; y: number }>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement) || !element.getClientRects().length || element.matches(':disabled, [aria-disabled="true"]')) throw new Error('The pointer target is not an enabled visible element.');
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.left + ${x});
      const y = Math.round(rect.top + ${y});
      if (${x} >= rect.width || ${y} >= rect.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !element.contains(document.elementFromPoint(x, y))) throw new Error('The pointer position is outside or obscures the target.');
      return { x, y };
    })()`);
    if (kind !== 'safari') {
      try {
        await session('actions', 'POST', {
          actions: [
            {
              type: 'pointer',
              id: 'desktop-pointer',
              parameters: { pointerType: 'mouse' },
              actions: [
                { type: 'pointerMove', origin: 'viewport', duration: 0, ...point },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerUp', button: 0 },
              ],
            },
          ],
        });
      } finally {
        await session('actions', 'DELETE');
      }
      return;
    }
    // System Events coordinate clicks perform accessibility actions, which do
    // not initialize canvas selection. Quartz posts actual macOS pointer input.
    const post = (mode: 'move' | 'click', screenX: number, screenY: number) =>
      command(
        '/usr/bin/osascript',
        [
          '-l',
          'JavaScript',
          '-e',
          `
        console.log('pointer: importing frameworks');
        ObjC.import('CoreGraphics');
        ObjC.import('CoreFoundation');
        console.log('pointer: frameworks imported');
        function run(argv) {
          var point = { x: Number(argv[1]), y: Number(argv[2]) };
          console.log('pointer: preflight');
          if (typeof $.CGPreflightPostEventAccess !== 'function')
            ObjC.bindFunction('CGPreflightPostEventAccess', ['bool', []]);
          var permitted = $.CGPreflightPostEventAccess();
          console.log('pointer: post-event access ' + permitted);
          if (!permitted) throw new Error('The native input host is not permitted to post pointer events.');
          var types = argv[0] === 'move' ? [$.kCGEventMouseMoved] : [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp];
          types.forEach(function(type) {
            console.log('pointer: creating event ' + type);
            var event = $.CGEventCreateMouseEvent($(), type, point, $.kCGMouseButtonLeft);
            console.log('pointer: validating event ' + type);
            if (!event || typeof event.isNil !== 'function' || event.isNil())
              throw new Error('Quartz did not return a nonnil bridged event: ' + Automation.getDisplayString(event, true));
            try {
              console.log('pointer: posting event ' + type);
              $.CGEventPost($.kCGHIDEventTap, event);
              console.log('pointer: posted event ' + type);
            } finally {
              console.log('pointer: releasing event ' + type);
              $.CFRelease(event);
              console.log('pointer: released event ' + type);
            }
          });
          return JSON.stringify({ mode: argv[0], point: point, posted: types.length });
        }
      `,
          mode,
          String(screenX),
          String(screenY),
        ],
        10_000,
      );
    const bounds = (await applescript('tell application "Safari" to get bounds of front window'))
      .split(',')
      .map(Number);
    assert.ok(bounds.length === 4 && bounds.every(Number.isFinite));
    const [left, top, right, bottom] = bounds;
    assert.ok(right > left && bottom > top);
    const screen = { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
    const key = JSON.stringify(`__spinelPointer_${randomUUID().replaceAll('-', '')}`);
    type Pointer = { x: number; y: number; trusted: boolean; target: boolean };
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const state = globalThis[${key}] = {};
      state.observe = event => { state[event.type] = { x: event.clientX, y: event.clientY, trusted: event.isTrusted, target: element.contains(event.target) }; };
      addEventListener('mousemove', state.observe, true);
      addEventListener('mousedown', state.observe, true);
    })()`);
    try {
      // Observe a real move inside the current window to locate the viewport;
      // this avoids guessing toolbar, border or sidebar offsets.
      await post('move', screen.x, screen.y);
      const moved = await poll(
        () => evaluate<Pointer | null>(`globalThis[${key}].mousemove || null`),
        Boolean,
        'Safari did not receive native pointer movement',
      );
      assert.ok(moved?.trusted, 'Safari pointer movement must be trusted native input.');
      await post('click', screen.x + point.x - moved.x, screen.y + point.y - moved.y);
      const clicked = await poll(
        () => evaluate<Pointer | null>(`globalThis[${key}].mousedown || null`),
        Boolean,
        'Safari did not receive the native pointer click',
      );
      assert.ok(clicked?.trusted && clicked.target, 'The native click did not reach the target.');
      assert.ok(Math.abs(clicked.x - point.x) <= 1 && Math.abs(clicked.y - point.y) <= 1);
    } finally {
      await evaluate(`(() => {
        const state = globalThis[${key}];
        if (state) { removeEventListener('mousemove', state.observe, true); removeEventListener('mousedown', state.observe, true); delete globalThis[${key}]; }
      })()`);
    }
  }
  async function goto(url: string) {
    assert.ok(browserPid, 'Start the browser before navigating.');
    const target = new URL(url).href;
    if (kind !== 'safari') {
      await session('url', 'POST', { url: target });
      return;
    }
    // A page-only marker witnesses a new document, including a same-URL reload
    // or an authentication redirect. It never reconstructs persisted storage.
    const marker = JSON.stringify(`__spinelNavigation_${randomUUID().replaceAll('-', '')}`);
    await safariScript(`globalThis[${marker}] = true; void 0;`);
    await applescript(
      'on run argv\n tell application "Safari" to set URL of current tab of front window to item 1 of argv\nend run',
      target,
    );
    await poll(
      async () =>
        object(
          JSON.parse(
            await safariScript(
              `JSON.stringify({ previous: globalThis[${marker}] === true, state: document.readyState })`,
            ),
          ),
        ),
      (value) => value.previous === false && value.state === 'complete',
      'Safari navigation did not complete',
    );
  }

  async function stop(): Promise<DesktopBrowserStop> {
    const stoppingPid = browserPid;
    const driverPid = driver?.pid ?? null;
    const errors: unknown[] = [];
    try {
      if (kind === 'safari' && browserPid) {
        assert.equal(
          await processIdentity(browserPid),
          browserIdentity,
          'The Safari process identity changed.',
        );
        await applescript('tell application "Safari" to quit');
      } else if (sessionId) {
        await request(`session/${sessionId}`, 'DELETE', undefined, 45_000);
      }
      if (browserPid) {
        await poll(
          () => processIdentity(browserPid!),
          (value) => value !== browserIdentity,
          'Browser did not exit after graceful quit',
        );
      }
    } catch (error) {
      errors.push(error);
    }
    // Only the child driver started here receives a signal; never pkill browsers.
    if (driver && driver.exitCode === null && driver.signalCode === null) {
      driver.kill('SIGTERM');
      try {
        await poll(
          async () => driver!.exitCode !== null || driver!.signalCode !== null,
          Boolean,
          'Driver did not exit',
        );
      } catch (error) {
        driver.kill('SIGKILL');
        errors.push(error);
      }
    }
    const browserExited =
      stoppingPid === null ? null : (await processIdentity(stoppingPid)) !== browserIdentity;
    const driverExited = !driver || driver.exitCode !== null || driver.signalCode !== null;
    if (browserExited === false) errors.push(new Error('Browser exit was not witnessed.'));
    if (!driverExited) errors.push(new Error('Driver exit was not witnessed.'));
    if (errors.length) throw new AggregateError(errors, `Could not finish ${kind} teardown.`);
    previousBrowserPid = stoppingPid ?? previousBrowserPid;
    browserPid = null;
    browserIdentity = '';
    sessionId = '';
    driver = null;
    return {
      kind,
      browserPid: stoppingPid,
      driverPid,
      browserExited,
      driverExited,
      stoppedAt: new Date().toISOString(),
    };
  }

  return {
    async start(url) {
      assert.equal(process.platform, 'darwin', 'This evidence requires native macOS browsers.');
      assert.ok(
        !browserPid && !driver && !sessionId,
        'Stop the previous browser before restarting.',
      );
      await mkdir(outputDir, { recursive: true });
      let actualPath: string;
      let version: string;
      let driverVersion: string | null = null;
      if (kind === 'safari') {
        // Ordinary Safari uses the disposable hosted user's real profile. It
        // cannot use an arbitrary user-data-dir; do not pretend this is one.
        assert.equal(process.env.GITHUB_ACTIONS, 'true');
        assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
        assert.equal(await safariPid(), null, 'Safari is already running outside this adapter.');
        actualPath = await realpath(homedir());
        version = await command('/usr/libexec/PlistBuddy', [
          '-c',
          'Print :CFBundleShortVersionString',
          '/Applications/Safari.app/Contents/Info.plist',
        ]);
        await command('/usr/bin/open', ['-a', 'Safari', 'about:blank']);
        browserPid = await poll(safariPid, (value) => value !== null, 'Safari did not start');
        assert.ok(browserPid);
        browserIdentity = await processIdentity(browserPid);
        await poll(
          () => safariScript('document.readyState'),
          (value) => value === 'complete',
          'Safari page did not load',
        );
        await goto(url);
      } else {
        await mkdir(requestedPath, { recursive: true });
        actualPath = await realpath(requestedPath);
        const executable = await driverPath(kind);
        await access(binaries[kind], constants.X_OK);
        driverVersion = await command(executable, ['--version']);
        const port = await freePort();
        let marionette = await freePort();
        while (marionette === port) marionette = await freePort();
        const args =
          kind === 'chrome'
            ? [`--port=${port}`, '--allowed-ips=127.0.0.1']
            : [
                '--host',
                '127.0.0.1',
                '--port',
                String(port),
                '--marionette-port',
                String(marionette),
              ];
        const log = await open(join(outputDir, `${kind}-driver-${++launches}.log`), 'w');
        try {
          spawnError = undefined;
          driver = spawn(executable, args, { stdio: ['ignore', log.fd, log.fd] });
          driver.once('error', (error) => {
            spawnError = error;
          });
        } finally {
          await log.close();
        }
        endpoint = `http://127.0.0.1:${port}`;
        await poll(
          () => request('status', 'GET', undefined, 1500),
          (value) => object(value).ready === true,
          'WebDriver did not become ready',
        );
        const result = object(
          await request(
            'session',
            'POST',
            {
              capabilities: {
                alwaysMatch: {
                  browserName: kind,
                  acceptInsecureCerts: true,
                  pageLoadStrategy: 'normal',
                  timeouts: { implicit: 0, pageLoad: 30_000, script: 30_000 },
                  ...(kind === 'chrome'
                    ? {
                        'goog:chromeOptions': {
                          binary: binaries.chrome,
                          args: [
                            `--user-data-dir=${actualPath}`,
                            '--no-first-run',
                            '--no-default-browser-check',
                            '--window-size=1280,900',
                          ],
                        },
                      }
                    : {
                        'moz:firefoxOptions': {
                          binary: binaries.firefox,
                          args: ['--profile', actualPath],
                        },
                      }),
                },
              },
            },
            90_000,
          ),
        );
        assert.equal(typeof result.sessionId, 'string');
        sessionId = result.sessionId as string;
        const capabilities = object(result.capabilities);
        assert.equal(capabilities.browserName, kind);
        assert.equal(typeof capabilities.browserVersion, 'string');
        version = capabilities.browserVersion as string;
        const returnedProfile =
          kind === 'firefox'
            ? capabilities['moz:profile']
            : object(capabilities.chrome).userDataDir;
        assert.equal(typeof returnedProfile, 'string');
        assert.equal(
          await realpath(returnedProfile as string),
          actualPath,
          'The driver substituted a different profile.',
        );
        if (kind === 'firefox') {
          assert.ok(Number.isSafeInteger(capabilities['moz:processID']));
          browserPid = capabilities['moz:processID'] as number;
        } else {
          const processes = await command('/bin/ps', ['-axo', 'pid=', '-o', 'command=']);
          const matches = processes
            .split('\n')
            .filter(
              (line) =>
                line.includes(binaries.chrome) &&
                line.includes(`--user-data-dir=${actualPath}`) &&
                !line.includes('--type='),
            );
          assert.equal(
            matches.length,
            1,
            'Expected one Chrome process using the requested profile.',
          );
          browserPid = Number(matches[0].trim().split(/\s+/, 1)[0]);
        }
        assert.ok(Number.isSafeInteger(browserPid) && browserPid! > 0);
        browserIdentity = await processIdentity(browserPid!);
        assert.ok(browserIdentity, 'The browser process could not be observed.');
        if (kind === 'firefox') await session('window/rect', 'POST', { width: 1280, height: 900 });
        await goto(url);
      }
      assert.notEqual(
        browserPid,
        previousBrowserPid,
        'A restart must create a new browser process.',
      );
      const info = await stat(actualPath, { bigint: true });
      return {
        kind,
        version,
        userAgent: await evaluate<string>('navigator.userAgent'),
        profile: {
          mode: kind === 'safari' ? 'ordinary-hosted-safari-user' : 'explicit-directory',
          requestedPath,
          actualPath,
          directoryDevice: String(info.dev),
          directoryInode: String(info.ino),
        },
        browserPid: browserPid!,
        previousBrowserPid,
        driverPid: driver?.pid ?? null,
        driverVersion,
        startedAt: new Date().toISOString(),
      };
    },
    goto,
    evaluate,
    focus: (selector) => focusAt(selector, 0),
    press,
    clickAt,
    resolveStoragePrompt,
    async type(text) {
      assert.ok(browserPid, 'Start the browser before typing.');
      if (kind === 'safari') {
        await applescript(
          'on run argv\n tell application "Safari" to activate\n tell application "System Events" to keystroke (item 1 of argv)\nend run',
          text,
        );
      } else {
        const active = object(await session('element/active'));
        assert.equal(typeof active[elementKey], 'string');
        await session(`element/${active[elementKey]}/value`, 'POST', { text });
      }
    },
    async click(selector, index = 0) {
      assert.ok(Number.isSafeInteger(index) && index >= 0);
      if (kind === 'safari') {
        await focusAt(selector, index);
        await press('Enter');
      } else {
        const elements = await session('elements', 'POST', {
          using: 'css selector',
          value: selector,
        });
        assert.ok(Array.isArray(elements) && elements[index], 'No matching element at that index.');
        const id = object(elements[index])[elementKey];
        assert.equal(typeof id, 'string');
        await session(`element/${id}/click`, 'POST', {});
      }
    },
    async screenshot(path, scope = 'content') {
      assert.ok(browserPid, 'Start the browser before capturing it.');
      if (scope === 'screen') return captureScreen(path);
      await mkdir(dirname(resolve(path)), { recursive: true });
      if (kind === 'safari') {
        await applescript('tell application "Safari" to activate');
        const bounds = (
          await applescript('tell application "Safari" to get bounds of front window')
        )
          .split(',')
          .map(Number);
        assert.ok(bounds.length === 4 && bounds.every(Number.isFinite));
        const [left, top, right, bottom] = bounds;
        assert.ok(right > left && bottom > top);
        await command('/usr/sbin/screencapture', [
          '-x',
          `-R${left},${top},${right - left},${bottom - top}`,
          resolve(path),
        ]);
      } else {
        const value = await session('screenshot');
        assert.equal(typeof value, 'string');
        await writeFile(path, Buffer.from(value as string, 'base64'));
      }
    },
    stop,
  };
}
