import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import {
  inputCounterDiagnostic,
  inputCounterFocusScript,
  inputCounterInstallScript,
  inputCounterReadScript,
  inputEventLimit,
  inputEventTypes,
} from './browserstack-input-observation.ts';

function fixture() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const editor = {
    matches: () => true,
    closest: () => ({ getAttribute: () => 'editor' }),
    get textContent(): never {
      throw new Error('Content must not be read.');
    },
  };
  const document = {
    activeElement: editor,
    addEventListener: (type: string, listener: (event: any) => void, options: unknown) => {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { capture: true, passive: true });
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: (event: any) => void, capture: unknown) => {
      assert.equal(capture, true);
      listeners.get(type)?.delete(listener);
    },
  };
  const window: Record<string, any> = {};
  const context = createContext({ window, document });
  const run = (script: string, args: unknown[] = []) =>
    runInContext(`(function(){${script}}).apply(null, args)`, Object.assign(context, { args }));
  const read = (stop = false) => inputCounterDiagnostic(run(inputCounterReadScript, [stop]));
  const emit = (type: string, extra: Record<string, unknown> = {}) => {
    const event = {
      type,
      target: editor,
      isTrusted: true,
      isComposing: false,
      eventPhase: 1,
      defaultPrevented: false,
      get data(): never {
        throw new Error('Input data must not be read.');
      },
      get key(): never {
        throw new Error('Key values must not be read.');
      },
      ...extra,
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  assert.equal(run(inputCounterInstallScript), true);
  assert.equal(run(inputCounterFocusScript, [0]), editor);
  return { window, document, editor, listeners, run, read, emit };
}

test('native input observation waits for dispatch completion and copies content-free metadata', () => {
  const f = fixture();
  const event = f.emit('beforeinput', { inputType: 'insertText' });
  const pending = f.read();
  assert.equal(pending.trace?.pending, 1);
  assert.equal(pending.trace?.events[0].preventedAfterDispatch, null);
  assert.equal(
    f.window.__spinelInputCount.mark(1),
    false,
    'an active dispatch cannot be discarded',
  );
  event.defaultPrevented = true; // A later synchronous listener cancels.
  event.eventPhase = 0;
  const finished = f.read();
  assert.equal(finished.trace?.pending, 0);
  assert.equal(finished.trace?.events[0].preventedAtCapture, false);
  assert.equal(finished.trace?.events[0].preventedAfterDispatch, true);
  assert.equal(
    pending.trace?.events[0].preventedAfterDispatch,
    null,
    'old snapshots stay unchanged',
  );
  finished.trace!.events[0].trusted = false;
  assert.equal(f.read().trace?.events[0].trusted, true);
  assert.equal(f.read().count, 0, 'beforeinput does not stand in for insertion');
});

test('per-key ranges retain gaps, focus changes and insertion counts without claiming causation', () => {
  const f = fixture();
  f.emit('input', { inputType: 'insertText' }).eventPhase = 0;
  f.emit('input', { inputType: 'deleteContentBackward' }).eventPhase = 0;
  const first = f.read();
  assert.equal(first.count, 1);
  assert.deepEqual(
    first.trace?.events.map((event) => event.sequence),
    [0, 1],
  );
  assert.equal(f.run(inputCounterFocusScript, [1]), f.editor);
  const noEvent = f.read();
  assert.deepEqual(noEvent.trace, {
    current: true,
    index: 1,
    start: 2,
    end: 2,
    dropped: 0,
    pending: 0,
    events: [],
  });
  // A range identifies observation order only; this could be a late earlier event.
  f.emit('input', { inputType: 'insertText', target: { matches: () => false } }).eventPhase = 0;
  const late = f.read();
  assert.equal(late.count, 2);
  assert.equal(late.trace?.events[0].sequence, 2);
  assert.equal(late.trace?.events[0].editor, false);
  assert.equal(late.trace?.events[0].targetIsActive, false);
  assert.equal(first.trace?.end, 2);
});

test('overflow bounds retained event references and remains visible after marking another key', () => {
  const f = fixture();
  for (let i = 0; i <= inputEventLimit; i++) f.emit('keydown').eventPhase = 0;
  const overflow = f.read();
  assert.equal(overflow.trace?.events.length, inputEventLimit);
  assert.equal(overflow.trace?.dropped, 1);
  assert.equal(overflow.trace?.end, inputEventLimit + 1);
  assert.equal(f.run(inputCounterFocusScript, [1]), f.editor);
  assert.equal(f.read().trace?.dropped, 1, 'a new range cannot erase overflow');
});

test('stopped and replaced recorders release listeners and cannot touch the replacement', () => {
  const f = fixture();
  const old = f.window.__spinelInputCount;
  const listener = [...f.listeners.get('input')!][0];
  f.emit('input', { inputType: 'insertText' }); // Pending reference is released by stop.
  assert.equal(f.run(inputCounterInstallScript), true);
  const replacement = f.window.__spinelInputCount;
  old.stop();
  assert.equal(f.window.__spinelInputCount, replacement);
  listener({ type: 'input', inputType: 'insertText' });
  assert.equal(f.read().count, 0);
  assert.equal(f.read(true).trace?.current, true, 'removal returns its own final snapshot');
  assert.equal(f.read().installed, false);
  assert.equal('__spinelInputCount' in f.window, false);
  for (const type of inputEventTypes) assert.equal(f.listeners.get(type)?.size, 0);
});

test('malformed, missing and injected input observations fail closed without retaining extra fields', () => {
  const f = fixture();
  f.emit('keyup').eventPhase = 0;
  const good = f.read();
  const injected = structuredClone(good) as any;
  injected.secret = 'do-not-retain';
  injected.trace.events[0].key = 'do-not-retain';
  assert.equal(JSON.stringify(inputCounterDiagnostic(injected)).includes('do-not-retain'), false);
  for (const corrupt of [
    (x: any) => {
      x.trace.events[0].type = 'secret';
    },
    (x: any) => {
      x.trace.events[0].sequence = 2;
    },
    (x: any) => {
      x.trace.end = 2;
    },
    (x: any) => {
      x.trace.pending = 1;
    },
    (x: any) => {
      x.trace.events = Array(inputEventLimit + 1).fill(x.trace.events[0]);
    },
  ]) {
    const bad = structuredClone(good);
    corrupt(bad);
    assert.equal(inputCounterDiagnostic(bad).trace, null);
  }
  assert.deepEqual(inputCounterDiagnostic({ count: -1, focus: 'bad name', editor: 'yes' }), {
    installed: false,
    count: null,
    focus: null,
    editor: false,
    trace: null,
  });
});

test('a failed final read still removes the observer and preserves its failure', () => {
  const f = fixture();
  const failure = new Error('read-failed');
  f.window.__spinelInputCount.read = () => {
    throw failure;
  };
  assert.throws(
    () => f.read(true),
    (error) => error === failure,
  );
  assert.equal('__spinelInputCount' in f.window, false);
  for (const type of inputEventTypes) assert.equal(f.listeners.get(type)?.size, 0);
});
