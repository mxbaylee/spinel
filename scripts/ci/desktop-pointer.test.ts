import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import {
  clickSafariPointer,
  safariPointerIdentityScript,
  safariPointerPostScript,
} from './desktop-pointer.ts';
import type { PointerBoundary } from './desktop-pointer.ts';

function fixture() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const records: Record<string, unknown>[] = [];
  const posts: { mode: string; point: { x: number; y: number } }[] = [];
  let obscured = false;
  let focused = true;
  let replaced = false;
  let offset = 0;
  let reads = 0;
  class Element {
    isConnected = true;
    getClientRects() {
      return [{}];
    }
    getBoundingClientRect() {
      return { x: offset, y: 0, width: 1000, height: 800 };
    }
    matches() {
      return false;
    }
    contains(target: unknown) {
      return target === this;
    }
  }
  const element = new Element();
  const context = createContext({
    HTMLElement: Element,
    document: {
      querySelector: () => (replaced ? new Element() : element),
      elementFromPoint: () => (obscured ? {} : element),
      hasFocus: () => focused,
      visibilityState: 'visible',
    },
    addEventListener(type: string, fn: (event: unknown) => void) {
      const values = listeners.get(type) ?? new Set();
      values.add(fn);
      listeners.set(type, values);
    },
    removeEventListener(type: string, fn: (event: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
  });
  const emit = (
    type: string,
    screen: { x: number; y: number },
    changes: Record<string, unknown> = {},
  ) => {
    const event = {
      type,
      screenX: screen.x,
      screenY: screen.y,
      clientX: screen.x - 100,
      clientY: screen.y - 150,
      isTrusted: true,
      target: element,
      ...changes,
    };
    for (const fn of listeners.get(type) ?? []) fn(event);
  };
  const boundary: PointerBoundary = {
    evaluate: async (expression) =>
      JSON.parse(JSON.stringify(runInContext(expression, context, { timeout: 100 })) ?? 'null'),
    identity: async () => ({
      pid: 42,
      windowId: 7,
      tabIndex: 1,
      bounds: { x: 100, y: 100, width: 1000, height: 800 },
    }),
    post: async (mode, point, evidence) => {
      posts.push({ mode, point });
      evidence.posted = mode === 'move' ? 1 : 2;
      emit(mode === 'move' ? 'mousemove' : 'mousedown', point);
    },
    poll: async (read, accept, label) => {
      // Deterministic withheld-event control; production supplies the existing 30s poll.
      for (let i = 0; i < 3; i++) {
        reads++;
        const value = await read();
        if (accept(value)) return value;
      }
      throw new Error(label);
    },
    record: async (evidence) => {
      records.push(evidence);
    },
  };
  return {
    boundary,
    records,
    posts,
    emit,
    context,
    element,
    obscured: () => {
      obscured = true;
    },
    unfocused: () => {
      focused = false;
    },
    replace: () => {
      replaced = true;
    },
    reads: () => reads,
    move: () => {
      offset = 10;
    },
    clean: () =>
      [...listeners.values()].every((set) => set.size === 0) &&
      !Object.keys(context).some((key) => key.startsWith('__spinelPointer_')),
    click: () => clickSafariPointer(boundary, '.univer-container', { x: 640, y: 200 }),
  };
}

test('posted coordinates, matching trusted delivery, identity and listener cleanup are retained', async () => {
  const f = fixture();
  await f.click();
  assert.deepEqual(f.posts, [
    { mode: 'move', point: { x: 600, y: 500 } },
    { mode: 'click', point: { x: 740, y: 350 } },
  ]);
  assert.equal(f.records[0].phase, 'delivered');
  assert.equal(f.records[0].observerRemoved, true);
  assert.equal(
    (f.records[0].clickObservation as { clicked: { target: boolean } }).clicked.target,
    true,
  );
  assert.ok(f.clean());
});

test('unrelated movement cannot supply a false viewport offset', async () => {
  const f = fixture(),
    post = f.boundary.post;
  f.boundary.post = async (mode, point, evidence) => {
    if (mode === 'move') f.emit('mousemove', { x: 999, y: 888 });
    await post(mode, point, evidence);
    if (mode === 'move') f.emit('mousemove', { x: 111, y: 222 });
  };
  await f.click();
  assert.deepEqual(f.posts[1].point, { x: 740, y: 350 });
  assert.equal((f.records[0].movement as { events: unknown[] }).events.length, 3);
});

for (const mode of [
  'missing move',
  'unrelated move',
  'untrusted move',
  'missing click',
  'wrong target',
  'untrusted click',
  'wrong page coordinates',
  'wrong screen coordinates',
] as const)
  test(`${mode} rejects without replay and removes its observers`, async () => {
    const f = fixture(),
      post = f.boundary.post;
    f.boundary.post = async (kind, point, evidence) => {
      if (kind === 'move' && mode.includes('move')) {
        if (mode === 'unrelated move') f.emit('mousemove', { x: 1, y: 2 });
        if (mode === 'untrusted move') f.emit('mousemove', point, { isTrusted: false });
        return;
      }
      if (kind === 'click') {
        if (mode === 'missing click') return;
        const changes = {
          'wrong target': { target: {} },
          'untrusted click': { isTrusted: false },
          'wrong page coordinates': { clientX: 1 },
          'wrong screen coordinates': { screenX: 1 },
        }[
          mode as
            | 'wrong target'
            | 'untrusted click'
            | 'wrong page coordinates'
            | 'wrong screen coordinates'
        ];
        if (changes) {
          f.emit('mousedown', point, changes);
          return;
        }
      }
      await post(kind, point, evidence);
    };
    await assert.rejects(f.click(), /native|coordinates/);
    assert.ok(f.reads() <= 4);
    assert.ok(f.clean());
    assert.notEqual(f.records[0].phase, 'delivered');
    assert.ok(f.records[0].finalObservation);
  });

for (const change of ['obscured', 'unfocused', 'replace', 'move'] as const)
  test(`${change} target after calibration refuses native click`, async () => {
    const f = fixture(),
      post = f.boundary.post;
    f.boundary.post = async (...args) => {
      await post(...args);
      f[change]();
    };
    await assert.rejects(f.click(), /no longer visible/);
    assert.deepEqual(
      f.posts.map((post) => post.mode),
      ['move'],
    );
    assert.ok(f.clean());
  });

test('changed native identity prevents posting to a different window', async () => {
  const f = fixture(),
    identity = f.boundary.identity;
  let calls = 0;
  f.boundary.identity = async () => ({ ...(await identity()), windowId: ++calls === 1 ? 7 : 8 });
  await assert.rejects(f.click(), /window changed/);
  assert.deepEqual(
    f.posts.map((post) => post.mode),
    ['move'],
  );
  assert.ok(f.clean());
});

test('page replacement and secondary cleanup failures preserve the first posting error', async () => {
  const f = fixture(),
    first = new Error('native post failed'),
    evaluate = f.boundary.evaluate;
  f.boundary.post = async () => {
    throw first;
  };
  f.boundary.evaluate = async (expression) => {
    if (!expression.includes('addEventListener')) throw new Error('page disappeared');
    return evaluate(expression);
  };
  await assert.rejects(f.click(), (error) => error === first);
  assert.equal(f.records[0].phase, 'move-post');
  assert.match(String(f.records[0].cleanupError), /page disappeared/);
  assert.match(String(f.records[0].observationError), /page disappeared/);
});

test('cleanup failure alone cannot report a successful action', async () => {
  const f = fixture(),
    evaluate = f.boundary.evaluate;
  f.boundary.evaluate = async (expression) => {
    if (expression.includes('removeEventListener')) throw new Error('cleanup failed');
    return evaluate(expression);
  };
  await assert.rejects(f.click(), /cleanup failed/);
});

test('bounded observations retain a matching move even after the diagnostic event cap', async () => {
  const f = fixture(),
    post = f.boundary.post;
  f.boundary.post = async (...args) => {
    if (args[0] === 'move') for (let i = 0; i < 100; i++) f.emit('mousemove', { x: 1, y: i });
    await post(...args);
  };
  await f.click();
  assert.equal((f.records[0].finalObservation as { events: unknown[] }).events.length, 16);
});

for (const changed of ['frontmost', 'window', 'tab', 'minimized', 'hidden'])
  test(`native identity script rejects ${changed}`, () => {
    const target = {
      id: () => 7,
      currentTab: () => ({ index: () => (changed === 'tab' ? 2 : 1) }),
      visible: () => changed !== 'hidden',
      miniaturized: () => changed === 'minimized',
      bounds: () => ({ x: 100, y: 100, width: 1000, height: 800 }),
    };
    const windows = Object.assign([{ id: () => (changed === 'window' ? 8 : 7) }], {
      byId: () => target,
    });
    assert.throws(
      () =>
        runInNewContext(
          safariPointerIdentityScript + '; run(["42", "7", "1"])',
          {
            Application: () => ({ frontmost: () => changed !== 'frontmost', windows }),
          },
          { timeout: 100 },
        ),
      /pointer target changed/,
    );
  });

for (const defect of ['none', 'permission', 'nil', 'type', 'location'] as const)
  test(`Quartz post script validates native events: ${defect}`, () => {
    const posted: unknown[] = [];
    const $ = Object.assign(() => null, {
      CGPreflightPostEventAccess: () => defect !== 'permission',
      kCGEventMouseMoved: 5,
      kCGEventLeftMouseDown: 1,
      kCGEventLeftMouseUp: 2,
      kCGMouseButtonLeft: 0,
      kCGHIDEventTap: 0,
      CGEventCreateMouseEvent: (_source: unknown, type: number, point: unknown) =>
        defect === 'nil' ? null : { type, point },
      CGEventGetType: (event: { type: number }) => (defect === 'type' ? 99 : event.type),
      CGEventGetLocation: (event: { point: unknown }) =>
        defect === 'location' ? { x: 0, y: 0 } : event.point,
      CGEventPost: (_tap: unknown, event: unknown) => posted.push(event),
    });
    const execute = () =>
      runInNewContext(
        safariPointerPostScript + '; run(["click", "740", "350"])',
        {
          $,
          ObjC: { import: () => {} },
          console: { log: () => {} },
          Automation: { getDisplayString: () => 'nil' },
        },
        { timeout: 100 },
      );
    if (defect === 'none') {
      assert.equal(JSON.parse(execute()).posted, 2);
      assert.equal(posted.length, 2);
    } else {
      assert.throws(execute);
      assert.equal(posted.length, 0);
    }
  });
