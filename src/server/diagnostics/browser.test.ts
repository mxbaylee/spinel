import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { observeOperation } from '@spinel/diagnostics';
import type { DiagnosticEvent, DiagnosticRecord, Operation } from '@spinel/diagnostics';
import { BrowserDiagnostics, DIAGNOSTIC_SAMPLE_INTERVAL_MS } from '../../../web/diagnostics.ts';
import { AccountDiagnostics } from '../../../web/diagnosticsAccount.ts';
import { DiagnosticRateLimit } from './routes.ts';

const event = {
  name: 'operation.result',
  details: { operation: 'document-open', outcome: 'success', durationMs: 4 },
} as const;
const context = { component: 'editor' } as const;
const binding = 'a'.repeat(64);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Upload = { generation: string; binding: string; records: DiagnosticRecord[] };
function operationBundle(
  operation: Operation,
  outcome: 'success' | 'failure' | 'cancelled' = 'success',
) {
  const events: DiagnosticEvent[] = [];
  observeOperation((record) => events.push(record), context, operation, outcome, 7);
  return events;
}
function emitBundle(client: BrowserDiagnostics, events: readonly DiagnosticEvent[]) {
  const sink = client.capture();
  expect(sink).toBeDefined();
  const scope = { ...context, fileId: randomUUID(), runId: randomUUID() };
  for (const record of events) sink!(record, scope);
  return scope.runId;
}
const routineBundles: DiagnosticEvent[][] = [
  ...(['captured', 'skipped'] as const).map((outcome) => [
    { name: 'native.checkpoint', details: { outcome, durationMs: 7 } } as DiagnosticEvent,
  ]),
  [
    {
      name: 'offline.persistence',
      details: { outcome: 'persisted', reason: 'write', durationMs: 7 },
    },
    ...operationBundle('document-save-local'),
  ],
  ...(['not-prepared', 'read-only'] as const).map((reason) => [
    {
      name: 'offline.persistence',
      details: { outcome: 'skipped', reason, durationMs: 7 },
    } as DiagnosticEvent,
  ]),
  [
    ...operationBundle('document-save-server-ack'),
    { name: 'sync.client.acknowledged', details: { duplicate: false } },
  ],
  ...(['capacity', 'idle'] as const).map((reason) => [
    {
      name: 'native.flush',
      details: { reason, outcome: 'success', durationMs: 7, history: 32, collaboration: 32 },
    } as DiagnosticEvent,
    ...operationBundle('doc-compose'),
  ]),
  [{ name: 'sync.client.queue', details: { pendingCount: 32, oldestPendingAgeMs: 7 } }],
  [{ name: 'sync.client.queue', details: { pendingCount: 0, oldestPendingAgeMs: null } }],
  operationBundle('search'),
];

test('browser adapter captures only after a generation, freezes records and bounds its in-memory queue', async () => {
  vi.useFakeTimers();
  const generation = randomUUID(),
    bodies: { records: unknown[]; generation: string }[] = [];
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) return json({ generation, binding });
    const body = JSON.parse(String(options?.body));
    bodies.push(body);
    return json({ accepted: body.records.length, dropped: 0 });
  });
  const client = new BrowserDiagnostics({ accountId: randomUUID(), fetch: request });
  try {
    client.emit(event, context);
    expect(client.dropped).toBe(1);
    await client.start();
    const mutable: DiagnosticEvent = { ...event, details: { ...event.details } };
    client.emit(mutable, context);
    mutable.details.durationMs = 999;
    for (let i = 0; i < 265; i++) client.emit(event, context);
    expect(client.dropped).toBe(11);
    await client.flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].generation).toBe(generation);
    expect(bodies[0].records).toHaveLength(64);
    expect(bodies[0].records[0]).toMatchObject({ event: { details: { durationMs: 4 } } });
    expect(JSON.stringify(bodies[0])).not.toContain('actorId');
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test('a truncate response discards every pre-clear buffer rather than relabelling old events', async () => {
  vi.useFakeTimers();
  const oldGeneration = randomUUID(),
    newGeneration = randomUUID();
  let collections = 0;
  let release!: (response: Response) => void;
  const bodies: { generation: string; records: unknown[] }[] = [];
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection'))
      return json({ generation: ++collections === 1 ? oldGeneration : newGeneration, binding });
    bodies.push(JSON.parse(String(options?.body)));
    if (bodies.length === 1)
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return json({ accepted: 1, dropped: 0 });
  });
  const client = new BrowserDiagnostics({ accountId: randomUUID(), fetch: request });
  try {
    await client.start();
    client.emit(event, context);
    const pending = client.flush();
    client.emit(event, context); // Buffered while the first batch was in flight.
    release(json({ error: 'Collection restarted' }, 409));
    await pending;
    expect(client.dropped).toBe(2);
    await client.flush();
    expect(bodies).toHaveLength(1);
    client.emit(event, context);
    await client.flush();
    expect(bodies.map((body) => body.generation)).toEqual([oldGeneration, newGeneration]);
    expect(bodies[1].records).toHaveLength(1);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test('session loss stops collection and stale initialization cannot revive a stopped account', async () => {
  vi.useFakeTimers();
  let release!: (response: Response) => void;
  const request = vi.fn<typeof fetch>(
    async () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const client = new BrowserDiagnostics({ accountId: randomUUID(), fetch: request });
  try {
    const pending = client.start();
    client.stop();
    release(json({ generation: randomUUID(), binding }));
    await pending;
    client.emit(event, context);
    await client.flush();
    await client.start();
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.dropped).toBe(1);
    const revokedRequest = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/collection')
        ? json({ generation: randomUUID(), binding })
        : json({}, 401),
    );
    const revoked = new BrowserDiagnostics({ accountId: randomUUID(), fetch: revokedRequest });
    try {
      await revoked.start();
      revoked.emit(event, context);
      await revoked.flush();
      await revoked.start();
      revoked.emit(event, context);
      await revoked.flush();
      expect(revokedRequest).toHaveBeenCalledTimes(2);
    } finally {
      revoked.stop();
    }
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test.each(['suspend', 'stop'] as const)(
  '%s counts an abandoned in-flight batch once and ignores its late success',
  async (action) => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    let release!: (response: Response) => void;
    const request = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith('/collection')) return json({ generation: randomUUID(), binding });
      signal = options?.signal;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const client = new BrowserDiagnostics({ accountId: randomUUID(), fetch: request });
    try {
      await client.start();
      client.emit(event, context);
      const pending = client.flush();
      client.emit(event, context);
      client[action]();
      expect(signal?.aborted).toBe(true);
      expect(client.dropped).toBe(2);
      release(json({ accepted: 1, dropped: 0 }));
      await pending;
      expect(client.dropped).toBe(2);
      client.emit(event, context);
      await client.flush();
      expect(client.dropped).toBe(3);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      client.stop();
      vi.useRealTimers();
    }
  },
);

test('a fully acknowledged batch is not counted as lost on later sign-out', async () => {
  vi.useFakeTimers();
  const request = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith('/collection')
      ? json({ generation: randomUUID(), binding })
      : json({ accepted: 1, dropped: 0 }),
  );
  const client = new BrowserDiagnostics({ accountId: randomUUID(), fetch: request });
  try {
    await client.start();
    client.emit(event, context);
    await client.flush();
    client.stop();
    expect(client.dropped).toBe(0);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test('routine bundles remain complete and within the real actor quota during sustained observations', async () => {
  vi.useFakeTimers();
  let monotonicNow = 0;
  const actor = randomUUID(),
    generation = randomUUID();
  const rate = new DiagnosticRateLimit(() => monotonicNow);
  const uploads: Upload[] = [];
  const accepted: DiagnosticRecord[] = [];
  const expected = new Map<string, readonly DiagnosticEvent[]>();
  let refused = 0;
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) return json({ generation, binding });
    const upload = JSON.parse(String(options?.body)) as Upload;
    uploads.push(upload);
    if (!rate.take(actor, upload.records.length)) {
      refused++;
      return json({}, 429);
    }
    accepted.push(...upload.records);
    return json({ accepted: upload.records.length, dropped: 0 });
  });
  const client = new BrowserDiagnostics({
    accountId: actor,
    fetch: request,
    monotonicNow: () => monotonicNow,
  });
  try {
    await client.start();
    expect(DIAGNOSTIC_SAMPLE_INTERVAL_MS).toBe(30_000);
    expect(routineBundles).toHaveLength(11);
    expect(routineBundles.flat()).toHaveLength(25);
    for (let second = 0; second < 60; second++) {
      monotonicNow = second * 1000;
      for (const bundle of routineBundles) {
        const runId = emitBundle(client, bundle);
        if (second === 0 || second === 30) expected.set(runId, bundle);
      }
      await client.flush();
    }
    expect(refused).toBe(0);
    expect(uploads.map((upload) => upload.records.length)).toEqual([25, 25]);
    expect(accepted).toHaveLength(50);
    expect(new Set(accepted.map((record) => record.context.runId))).toEqual(
      new Set(expected.keys()),
    );
    for (const [runId, bundle] of expected)
      expect(
        accepted.filter((record) => record.context.runId === runId).map((record) => record.event),
      ).toEqual(bundle);
    expect(
      accepted
        .filter((record) => record.event.name === 'operation.count')
        .every((record) => 'metric' in record.event && record.event.metric.value === 1),
    ).toBe(true);
    expect(client.sampledOut).toBe(25 * 58);
    expect(client.dropped).toBe(client.sampledOut);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test('failure and cancellation bundles bypass routine sampling while raw emit stays unsampled', async () => {
  vi.useFakeTimers();
  const accepted: DiagnosticRecord[] = [];
  const expected: DiagnosticEvent[] = [];
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) return json({ generation: randomUUID(), binding });
    const { records } = JSON.parse(String(options?.body)) as Upload;
    accepted.push(...records);
    return json({ accepted: records.length, dropped: 0 });
  });
  const client = new BrowserDiagnostics({
    accountId: randomUUID(),
    fetch: request,
    monotonicNow: () => 0,
  });
  try {
    await client.start();
    const failures: DiagnosticEvent[][] = [];
    for (const outcome of ['failure', 'cancelled'] as const) {
      failures.push([{ name: 'native.checkpoint', details: { outcome, durationMs: 7 } }]);
      failures.push([
        { name: 'offline.persistence', details: { outcome, reason: 'write', durationMs: 7 } },
        ...operationBundle('document-save-local', outcome),
      ]);
      failures.push(operationBundle('document-save-server-ack', outcome));
      failures.push(operationBundle('search', outcome));
    }
    for (const reason of ['capacity', 'idle'] as const)
      failures.push([
        {
          name: 'native.flush',
          details: { reason, outcome: 'failure', durationMs: 7, history: 32, collaboration: 32 },
        },
        ...operationBundle('doc-compose', 'failure'),
      ]);
    for (let repeat = 0; repeat < 2; repeat++)
      for (const bundle of failures) {
        emitBundle(client, bundle);
        expected.push(...bundle);
        await client.flush();
      }
    for (let repeat = 0; repeat < 2; repeat++) {
      const bundle = operationBundle('search');
      for (const record of bundle) client.emit(record, context);
      expected.push(...bundle);
      await client.flush();
    }
    // Failure and raw-emission traffic must not consume a routine family's first sample.
    for (const bundle of routineBundles) {
      emitBundle(client, bundle);
      expected.push(...bundle);
      await client.flush();
      emitBundle(client, bundle);
      await client.flush();
    }
    expect(accepted.map((record) => record.event)).toEqual(expected);
    expect(client.sampledOut).toBe(25);
    expect(client.dropped).toBe(25);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test('sampling starts at the first observation, keeps bundles together and survives same-account suspension', async () => {
  vi.useFakeTimers();
  let monotonicNow = 0,
    wallNow = 1000;
  const generations = [randomUUID(), randomUUID()];
  let collections = 0;
  const uploads: Upload[] = [];
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection'))
      return json({ generation: generations[collections++], binding });
    const upload = JSON.parse(String(options?.body)) as Upload;
    uploads.push(upload);
    return json({ accepted: upload.records.length, dropped: 0 });
  });
  const client = new BrowserDiagnostics({
    accountId: randomUUID(),
    fetch: request,
    now: () => wallNow,
    monotonicNow: () => monotonicNow,
  });
  const search = operationBundle('search');
  try {
    await client.start();
    emitBundle(client, search);
    await client.flush();
    monotonicNow = 29_999;
    const delayed = client.capture()!,
      omitted = client.capture()!;
    omitted(search[0], context);
    monotonicNow = 30_000;
    for (const record of search.slice(1)) omitted(record, context);
    for (const record of search) delayed(record, context);
    await client.flush();
    expect(client.sampledOut).toBe(3);
    expect(uploads.map((upload) => upload.records.length)).toEqual([3, 3]);
    monotonicNow = 30_001;
    wallNow += 86_400_000;
    client.suspend();
    await client.start();
    emitBundle(client, search);
    delayed(event, context);
    await client.flush();
    expect(client.sampledOut).toBe(6);
    expect(client.dropped).toBe(7); // Six intentional omissions, one stale-scope record.
    const future = client.capture()!;
    monotonicNow = 60_000;
    wallNow = 1;
    for (const record of search) future(record, context);
    await client.flush();
    expect(uploads.map((upload) => upload.generation)).toEqual([
      generations[0],
      generations[0],
      generations[1],
    ]);
    expect(uploads[2].records.map((record) => record.event)).toEqual(search);
    expect(uploads[2].records.every((record) => record.occurredAt === 1)).toBe(true);
    expect(client.sampledOut).toBe(6);
    expect(client.dropped).toBe(7);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test('real quota exhaustion drops old buffers once and automatically verifies a fresh collection after one cooldown', async () => {
  vi.useFakeTimers();
  let now = 0,
    collections = 0;
  const actor = randomUUID(),
    oldGeneration = randomUUID(),
    freshGeneration = randomUUID();
  const freshBinding = 'b'.repeat(64);
  const rate = new DiagnosticRateLimit(() => now);
  const uploads: Upload[] = [];
  const accepted: DiagnosticRecord[] = [];
  let rejectBatch!: (response: Response) => void;
  let verifyFresh!: (response: Response) => void;
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) {
      if (++collections === 1) return json({ generation: oldGeneration, binding });
      return new Promise<Response>((resolve) => {
        verifyFresh = resolve;
      });
    }
    const upload = JSON.parse(String(options?.body)) as Upload;
    uploads.push(upload);
    if (!rate.take(actor, upload.records.length))
      return new Promise<Response>((resolve) => {
        rejectBatch = resolve;
      });
    accepted.push(...upload.records);
    return json({ accepted: upload.records.length, dropped: 0 });
  });
  const client = new BrowserDiagnostics({
    accountId: actor,
    fetch: request,
    now: () => now,
    monotonicNow: () => now,
  });
  try {
    await client.start();
    const oldScope = client.capture()!;
    for (let i = 0; i < 120; i++) client.emit(event, context);
    await client.flush();
    await client.flush();
    expect(accepted).toHaveLength(120);
    client.emit(event, context);
    client.emit(event, context);
    const pending = client.flush();
    for (let i = 0; i < 3; i++) client.emit(event, context);
    rejectBatch(json({}, 429));
    await pending;
    expect(client.dropped).toBe(5);
    expect(client.sampledOut).toBe(0);
    expect(client.capture()).toBeUndefined();
    await Promise.all([client.resume(), client.resume(), client.resume()]);
    expect(collections).toBe(1);
    now = 59_999;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(collections).toBe(1);
    expect(uploads).toHaveLength(3);
    now = 60_000;
    await vi.advanceTimersByTimeAsync(1);
    expect(collections).toBe(2);
    expect(client.capture()).toBeUndefined();
    await client.resume();
    expect(collections).toBe(2);
    verifyFresh(json({ generation: freshGeneration, binding: freshBinding }));
    await vi.advanceTimersByTimeAsync(0);
    oldScope(event, context);
    expect(client.dropped).toBe(6);
    const freshEvents = operationBundle('document-open');
    emitBundle(client, freshEvents);
    await client.flush();
    expect(uploads.map((upload) => upload.records.length)).toEqual([64, 56, 2, 3]);
    expect(uploads[3]).toMatchObject({ generation: freshGeneration, binding: freshBinding });
    expect(uploads[3].records.map((record) => record.event)).toEqual(freshEvents);
    expect(accepted).toHaveLength(123);
    expect(new Set(accepted.map((record) => record.id)).size).toBe(123);
    expect(client.dropped).toBe(6);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collections).toBe(2);
    expect(uploads).toHaveLength(4);
    expect(
      request.mock.calls.every(([url]) =>
        ['/api/diagnostics/collection', '/api/diagnostics/events'].includes(String(url)),
      ),
    ).toBe(true);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

test.each([
  ['hidden/offline', 'cooldown'],
  ['hidden/offline', 'verification'],
  ['stopped', 'cooldown'],
  ['stopped', 'verification'],
  ['replaced account', 'cooldown'],
  ['replaced account', 'verification'],
] as const)(
  '%s cancels rate recovery during %s without reviving an old scope',
  async (action, phase) => {
    vi.useFakeTimers();
    const firstAccount = randomUUID(),
      secondAccount = randomUUID();
    const clients = new Map<string, BrowserDiagnostics>();
    const collections: string[] = [];
    let releaseVerification: ((response: Response) => void) | undefined;
    let verificationSignal: AbortSignal | null | undefined;
    const request = vi.fn<typeof fetch>(async (url, options) => {
      if (!String(url).endsWith('/collection')) return json({}, 429);
      const actor = new Headers(options?.headers).get('X-Spinel-Diagnostic-Account')!;
      collections.push(actor);
      if (
        phase === 'verification' &&
        actor === firstAccount &&
        collections.filter((id) => id === actor).length === 2
      ) {
        verificationSignal = options?.signal;
        return new Promise<Response>((resolve) => {
          releaseVerification = resolve;
        });
      }
      return json({
        generation: randomUUID(),
        binding: actor === firstAccount ? binding : 'b'.repeat(64),
      });
    });
    const account = new AccountDiagnostics((accountId) => {
      const client = new BrowserDiagnostics({ accountId, fetch: request });
      clients.set(accountId, client);
      return client;
    });
    try {
      account.account(firstAccount);
      account.connection(true);
      await vi.advanceTimersByTimeAsync(0);
      const old = clients.get(firstAccount)!;
      const scope = account.begin()!;
      expect(scope).toBeDefined();
      old.emit(event, context);
      await old.flush();
      expect(old.dropped).toBe(1);
      if (phase === 'verification') {
        await vi.advanceTimersByTimeAsync(60_000);
        expect(releaseVerification).toBeDefined();
        expect(verificationSignal?.aborted).toBe(false);
      }
      if (action === 'hidden/offline') account.connection(false);
      else if (action === 'stopped') account.stop();
      else {
        account.account(secondAccount);
        account.connection(true);
      }
      if (releaseVerification) {
        expect(verificationSignal?.aborted).toBe(true);
        releaseVerification(json({ generation: randomUUID(), binding }));
      }
      await vi.advanceTimersByTimeAsync(120_000);
      expect(collections.filter((id) => id === firstAccount)).toHaveLength(
        phase === 'cooldown' ? 1 : 2,
      );
      expect(old.capture()).toBeUndefined();
      scope.sink(event, context);
      expect(old.dropped).toBe(2);
      expect(old.sampledOut).toBe(0);
      if (action === 'hidden/offline') {
        expect(account.begin()).toBeUndefined();
        account.connection(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(account.begin()).toBeDefined();
        expect(collections.filter((id) => id === firstAccount)).toHaveLength(
          phase === 'cooldown' ? 2 : 3,
        );
      } else if (action === 'stopped') {
        account.connection(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(account.begin()).toBeUndefined();
        expect(collections.filter((id) => id === firstAccount)).toHaveLength(
          phase === 'cooldown' ? 1 : 2,
        );
      } else {
        expect(collections.filter((id) => id === secondAccount)).toHaveLength(1);
        expect(account.begin()).toBeDefined();
        await old.resume();
        expect(collections.filter((id) => id === firstAccount)).toHaveLength(
          phase === 'cooldown' ? 1 : 2,
        );
      }
    } finally {
      account.stop();
      for (const client of clients.values()) client.stop();
      vi.useRealTimers();
    }
  },
);

test.each(['http', 'network'] as const)(
  'a %s failure still needs explicit reconnection instead of a rate cooldown retry',
  async (failure) => {
    vi.useFakeTimers();
    let collections = 0,
      uploads = 0;
    const request = vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith('/collection')) {
        collections++;
        return json({ generation: randomUUID(), binding });
      }
      if (++uploads === 1) {
        if (failure === 'network') throw new Error('Diagnostic transport unavailable');
        return json({}, 503);
      }
      const body = JSON.parse(String(options?.body)) as Upload;
      return json({ accepted: body.records.length, dropped: 0 });
    });
    const client = new BrowserDiagnostics({ accountId: randomUUID(), fetch: request });
    try {
      await client.start();
      client.emit(event, context);
      await client.flush();
      expect(client.dropped).toBe(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(collections).toBe(1);
      expect(uploads).toBe(1);
      expect(client.capture()).toBeUndefined();
      await client.resume();
      emitBundle(client, operationBundle('document-open'));
      await client.flush();
      expect(collections).toBe(2);
      expect(uploads).toBe(2);
      expect(client.dropped).toBe(1);
    } finally {
      client.stop();
      vi.useRealTimers();
    }
  },
);

test('intentional sampling loss counters remain bounded at their public safe-integer limit', async () => {
  vi.useFakeTimers();
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) return json({ generation: randomUUID(), binding });
    const body = JSON.parse(String(options?.body)) as Upload;
    return json({ accepted: body.records.length, dropped: 0 });
  });
  const client = new BrowserDiagnostics({
    accountId: randomUUID(),
    fetch: request,
    monotonicNow: () => 0,
  });
  try {
    await client.start();
    emitBundle(client, routineBundles[0]);
    await client.flush();
    client.sampledOut = Number.MAX_SAFE_INTEGER - 1;
    client.dropped = Number.MAX_SAFE_INTEGER - 1;
    for (let i = 0; i < 3; i++) emitBundle(client, routineBundles[0]);
    expect(client.sampledOut).toBe(Number.MAX_SAFE_INTEGER);
    expect(client.dropped).toBe(Number.MAX_SAFE_INTEGER);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});
