import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  nativeWindowInput,
  validateNativeWindowBoundary,
} from '../../e2e/doc-responsiveness-native-window.ts';
import {
  validateLoadedNativeScript,
  validateRetainedNativeSources,
  observeNativeWindowSources,
  prepareNativeWindowSources,
} from '../../e2e/doc-responsiveness-native-sources.ts';

const paragraphs = Array.from(
  { length: 16 },
  (_, index) =>
    `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
    'Keep the original page size and all of this text when navigating.',
);

test('window slicing preserves every original character and Enter without per-key fragmentation', () => {
  const plan = nativeWindowInput(paragraphs);
  const events = plan.flatMap((entry) => (entry.action === 'enter' ? ['Enter'] : [...entry.text]));
  const original = paragraphs.flatMap((text, index) => [...(index ? ['Enter'] : []), ...text]);
  assert.deepEqual(events, original);
  assert.equal(events.length, 2086);
  assert.equal(plan.length, 33); // Original31 spans plus exactly two cuts.
  for (const boundary of [384, 448]) {
    const index = plan.findIndex((entry) => entry.completed === boundary);
    assert.equal(
      plan.slice(0, index + 1).reduce((sum, x) => sum + x.text.length, 0),
      boundary,
    );
  }
  assert.throws(() => nativeWindowInput(paragraphs.slice(1)));
  assert.throws(() => nativeWindowInput([...paragraphs, 'extra']));
  assert.throws(() => nativeWindowInput(paragraphs.map((p, i) => (i === 0 ? p + '\r' : p))));
  assert.throws(() => nativeWindowInput(paragraphs.map((p, i) => (i === 0 ? p.slice(1) : p))));
});

function boundary(completed: 384 | 448) {
  const armed: any = { epoch: 'epoch', generation: 'generation', unitId: 'doc', timeOrigin: 1000 };
  const native: any = {
    unitId: 'doc',
    pending: { history: 0, collaboration: 0 },
    history: { undos: completed / 32, redos: 0 },
    drainWitness: {
      ...armed,
      completedStates: completed,
      expectedCompletedStates: 2086,
      sealedAt: null,
      invalidated: false,
      invalidations: [],
      nativeObservationAvailable: true,
      nativeFlushes: Array.from({ length: completed / 32 }, (_, i) => ({
        ...armed,
        phase: 'pair',
        completedStates: (i + 1) * 32,
        origin: 'policy-capacity',
        outcome: 'returned',
        before: { history: 32, collaboration: 32 },
        after: { history: 0, collaboration: 0 },
        startedAt: i * 10,
        endedAt: i * 10 + 2,
      })),
    },
  };
  const capture: any = {
    unitId: 'doc',
    states: completed * 2,
    phases: completed / 16,
    dropped: 0,
    errors: [],
    activePair: null,
    stopped: false,
    ownsMethods: true,
    phasesReturned: true,
  };
  const composition = { active: false, starts: 0, ends: 0 };
  return { native, capture, armed, composition };
}

test('source identity requires actual executed bytes and exact embedded prior-native content', () => {
  const path = 'node_modules/@univerjs/docs/lib/es/index.js';
  const source = 'exact prior native';
  const identities = { [path]: createHash('sha256').update(source).digest('hex') };
  const map = { version: 3, mappings: 'AAAA', sources: ['../' + path], sourcesContent: [source] };
  const emitted = Buffer.from('emitted native code');
  const validate = (executed = emitted.toString(), payload = map) =>
    validateLoadedNativeScript(executed, emitted, Buffer.from(JSON.stringify(payload)), identities);
  assert.deepEqual(validate(), identities);
  assert.throws(() => validate('stale loaded script'));
  assert.throws(() => validate(undefined, { ...map, sourcesContent: ['candidate native'] }));
  assert.throws(() => validate(undefined, { ...map, sourcesContent: [] }));
  assert.throws(() => validate(undefined, { ...map, version: 2 }));
  assert.throws(() =>
    validate(undefined, {
      ...map,
      sources: [map.sources[0], map.sources[0]],
      sourcesContent: [source, source],
    }),
  );
});

test('actual source collector retains executed bytes and final validation rejects missing/substituted members', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spn146-window-sources-'));
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const native = 'node_modules/@univerjs/docs/lib/es/index.js';
  const core = 'node_modules/@univerjs/core/lib/es/index.js';
  const identities = { [native]: digest('prior native'), [core]: digest('native Core') };
  const code = 'emitted JavaScript';
  const helper = 'generated preload helper';
  const map = JSON.stringify({
    version: 3,
    mappings: 'AAAA',
    sources: ['../' + native, '../' + core],
    sourcesContent: ['prior native', 'native Core'],
  });
  const dist = join(root, 'dist'),
    output = join(root, 'retained');
  class Session extends EventEmitter {
    commands: string[] = [];
    beforeNativeRead?: () => Promise<unknown>;
    wrongHelper = false;
    async send(method: string, args?: { scriptId: string }) {
      this.commands.push(method);
      if (method === 'Debugger.enable') {
        this.emit('Debugger.scriptParsed', {
          scriptId: '8',
          url: 'http://localhost:3100/helper.js',
        });
        this.emit('Debugger.scriptParsed', {
          scriptId: '7',
          url: 'http://localhost:3100/native.js',
        });
      }
      if (method === 'Debugger.getScriptSource' && args?.scriptId === '8')
        return { scriptSource: this.wrongHelper ? 'wrong loaded helper' : helper };
      if (method === 'Debugger.getScriptSource') await this.beforeNativeRead?.();
      return { scriptSource: code };
    }
  }
  const cdp = new Session();
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'native.js'), code);
    await writeFile(join(dist, 'helper.js'), helper);
    await writeFile(join(dist, 'native.js.map'), map);
    const prepared = await prepareNativeWindowSources(dist, identities);
    const observer = await observeNativeWindowSources(cdp as any, 'http://localhost:3100');
    const observed = await observer.retain(output, identities, prepared, dist);
    await observer.dispose();
    assert.deepEqual(cdp.commands, [
      'Debugger.enable',
      'Debugger.getScriptSource',
      'Debugger.getScriptSource',
      'Debugger.disable',
    ]);
    assert.equal(cdp.listenerCount('Debugger.scriptParsed'), 0);
    assert.deepEqual(observed.scripts[0].mapped, {});
    assert.equal(observed.scripts[0].mapStatus, 'absent-at-collection');
    assert.equal(observed.scripts[0].mapBytes, null);
    const blocked = join(root, 'blocked-output');
    await writeFile(blocked, 'not a directory');
    const blockedSession = new Session();
    const blockedObserver = await observeNativeWindowSources(
      blockedSession as any,
      'http://localhost:3100',
    );
    try {
      await assert.rejects(blockedObserver.retain(blocked, identities, prepared, dist), /EEXIST/);
    } finally {
      await blockedObserver.dispose();
    }
    assert.equal(blockedSession.listenerCount('Debugger.scriptParsed'), 0);
    await validateRetainedNativeSources(output, observed, identities);
    await writeFile(join(output, 'helper.js'), helper.replace('preload', 'changed'));
    await assert.rejects(
      validateRetainedNativeSources(output, observed, identities),
      /digest mismatch/,
    );
    await writeFile(join(output, 'helper.js'), helper);
    await writeFile(join(output, 'native.js'), code.replace('emitted', 'changed'));
    await assert.rejects(
      validateRetainedNativeSources(output, observed, identities),
      /digest mismatch/,
    );
    await writeFile(join(output, 'native.js'), code);
    await rm(join(output, 'native.js.map'));
    await assert.rejects(validateRetainedNativeSources(output, observed, identities), /ENOENT/);
    await writeFile(join(output, 'native.js.map'), map.replace('prior native', 'wrong native'));
    await assert.rejects(validateRetainedNativeSources(output, observed, identities));
    await writeFile(join(output, 'native.js.map'), map);
    await assert.rejects(
      validateRetainedNativeSources(output, observed, { [native]: digest('candidate native') }),
      /Wrong embedded/,
    );
    const receipt = JSON.parse(await readFile(join(output, 'binding.json'), 'utf8'));
    receipt.scripts.pop();
    await writeFile(join(output, 'binding.json'), JSON.stringify(receipt));
    await assert.rejects(validateRetainedNativeSources(output, observed, identities), /differs/);
    await rm(join(output, 'binding.json'));
    await assert.rejects(validateRetainedNativeSources(output, observed, identities), /ENOENT/);
    // Map absence cannot turn missing target identities, observed-present maps,
    // unrelated read errors or wrong runtime bytes into usable evidence.
    for (const failure of [
      'target-map-absent',
      'malformed-map',
      'map-disappeared',
      'map-is-directory',
      'wrong-helper',
      'map-appeared',
      'map-changed',
    ] as const) {
      await writeFile(join(dist, 'native.js.map'), map);
      const session = new Session();
      if (failure === 'target-map-absent') await rm(join(dist, 'native.js.map'));
      if (failure === 'malformed-map') await writeFile(join(dist, 'native.js.map'), '{');
      if (failure === 'map-disappeared')
        session.beforeNativeRead = () => rm(join(dist, 'native.js.map'));
      if (failure === 'map-is-directory') await mkdir(join(dist, 'helper.js.map'));
      if (failure === 'wrong-helper') session.wrongHelper = true;
      if (failure === 'map-appeared') await writeFile(join(dist, 'helper.js.map'), map);
      if (failure === 'map-changed')
        await writeFile(join(dist, 'native.js.map'), map.replace('prior native', 'other native'));
      const source = await observeNativeWindowSources(session as any, 'http://localhost:3100');
      try {
        await assert.rejects(source.retain(join(root, failure), identities, prepared, dist));
      } finally {
        await source.dispose();
      }
      assert.equal(session.listenerCount('Debugger.scriptParsed'), 0);
      if (failure === 'map-is-directory' || failure === 'map-appeared')
        await rm(join(dist, 'helper.js.map'), { recursive: true });
    }
    await assert.rejects(prepareNativeWindowSources(dist, identities), /Wrong embedded/);
    await rm(join(dist, 'native.js.map'));
    await assert.rejects(prepareNativeWindowSources(dist, identities), /binding incomplete/);
    await writeFile(join(root, 'outside.map'), map);
    await symlink(join(root, 'outside.map'), join(dist, 'native.js.map'));
    await assert.rejects(prepareNativeWindowSources(dist, identities), /escaped build/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed debugger setup releases its listener without acquiring a source observer', async () => {
  const cdp = new EventEmitter() as EventEmitter & { send: () => Promise<never> };
  const primary = new Error('debugger setup failed');
  cdp.send = async () => {
    throw primary;
  };
  await assert.rejects(
    observeNativeWindowSources(cdp as any, 'http://localhost:3100'),
    (error) => error === primary,
  );
  assert.equal(cdp.listenerCount('Debugger.scriptParsed'), 0);
});

for (const completed of [384, 448] as const) {
  test(`boundary${completed} needs actual coherent state, empty caches and complete owned native groups`, () => {
    const validate = (f: ReturnType<typeof boundary>) =>
      validateNativeWindowBoundary(f.native, f.capture, f.armed, completed, f.composition);
    validate(boundary(completed));
    const defects: Array<(f: ReturnType<typeof boundary>) => void> = [
      (f) => f.native.drainWitness.completedStates--,
      (f) => f.native.drainWitness.completedStates++,
      (f) => (f.native.drainWitness.epoch = 'stale'),
      (f) => (f.native.drainWitness.generation = 'stale'),
      (f) => f.native.drainWitness.timeOrigin++,
      (f) => (f.native.drainWitness.invalidated = true),
      (f) => (f.native.drainWitness.nativeObservationAvailable = false),
      (f) => f.native.pending.history++,
      (f) => f.native.pending.collaboration++,
      (f) => f.native.history.undos--,
      (f) => f.capture.phases--,
      (f) => f.capture.states--,
      (f) => f.capture.dropped++,
      (f) => (f.capture.activePair = 1),
      (f) => (f.capture.stopped = true),
      (f) => (f.capture.ownsMethods = false),
      (f) => (f.capture.phasesReturned = false),
      (f) => (f.composition.active = true),
      (f) => f.composition.starts++,
      (f) => f.native.drainWitness.nativeFlushes.pop(),
      (f) => (f.native.drainWitness.nativeFlushes[0].origin = 'policy-idle'),
      (f) => f.native.drainWitness.nativeFlushes[0].completedStates--,
      (f) => f.native.drainWitness.nativeFlushes[0].before.history--,
      (f) => f.native.drainWitness.nativeFlushes[0].after.collaboration++,
      (f) => (f.native.drainWitness.nativeFlushes[0].outcome = 'threw'),
    ];
    for (const defect of defects) {
      const f = boundary(completed);
      defect(f);
      assert.throws(() => validate(f));
    }
  });
}
