import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { DiagnosticEvent } from '@spinel/diagnostics';
import { BrowserDiagnostics } from '../../../web/diagnostics.ts';

const event = { name: 'operation.result', details: { operation: 'document-open', outcome: 'success', durationMs: 4 } } as const;
const context = { component: 'editor' } as const;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('browser adapter captures only after a generation, freezes records and bounds its in-memory queue', async () => {
  vi.useFakeTimers();
  const generation = randomUUID(), bodies: { records: unknown[]; generation: string }[] = [];
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) return json({ generation });
    const body = JSON.parse(String(options?.body)); bodies.push(body);
    return json({ accepted: body.records.length, dropped: 0 });
  });
  const client = new BrowserDiagnostics({ fetch: request });
  try {
    client.emit(event, context);
    expect(client.dropped).toBe(1);
    await client.start();
    const mutable: DiagnosticEvent = { ...event, details: { ...event.details } };
    client.emit(mutable, context); mutable.details.durationMs = 999;
    for (let i = 0; i < 265; i++) client.emit(event, context);
    expect(client.dropped).toBe(11);
    await client.flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].generation).toBe(generation);
    expect(bodies[0].records).toHaveLength(64);
    expect(bodies[0].records[0]).toMatchObject({ event: { details: { durationMs: 4 } } });
    expect(JSON.stringify(bodies[0])).not.toContain('actorId');
  } finally { client.stop(); vi.useRealTimers(); }
});

test('a truncate response discards every pre-clear buffer rather than relabelling old events', async () => {
  vi.useFakeTimers();
  const oldGeneration = randomUUID(), newGeneration = randomUUID();
  let collections = 0;
  let release!: (response: Response) => void;
  const bodies: { generation: string; records: unknown[] }[] = [];
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) return json({ generation: ++collections === 1 ? oldGeneration : newGeneration });
    bodies.push(JSON.parse(String(options?.body)));
    if (bodies.length === 1) return new Promise<Response>((resolve) => { release = resolve; });
    return json({ accepted: 1, dropped: 0 });
  });
  const client = new BrowserDiagnostics({ fetch: request });
  try {
    await client.start(); client.emit(event, context);
    const pending = client.flush();
    client.emit(event, context); // Buffered while the first batch was in flight.
    release(json({ error: 'Collection restarted' }, 409));
    await pending;
    expect(client.dropped).toBe(2);
    await client.flush();
    expect(bodies).toHaveLength(1);
    client.emit(event, context); await client.flush();
    expect(bodies.map((body) => body.generation)).toEqual([oldGeneration, newGeneration]);
    expect(bodies[1].records).toHaveLength(1);
  } finally { client.stop(); vi.useRealTimers(); }
});

test('session loss stops collection and stale initialization cannot revive a stopped account', async () => {
  vi.useFakeTimers();
  let release!: (response: Response) => void;
  const request = vi.fn<typeof fetch>(async () => new Promise<Response>((resolve) => { release = resolve; }));
  const client = new BrowserDiagnostics({ fetch: request });
  try {
    const pending = client.start(); client.stop();
    release(json({ generation: randomUUID() })); await pending;
    client.emit(event, context); await client.flush(); await client.start();
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.dropped).toBe(1);
    const revokedRequest = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/collection') ? json({ generation: randomUUID() }) : json({}, 401));
    const revoked = new BrowserDiagnostics({ fetch: revokedRequest });
    try {
      await revoked.start(); revoked.emit(event, context); await revoked.flush();
      await revoked.start(); revoked.emit(event, context); await revoked.flush();
      expect(revokedRequest).toHaveBeenCalledTimes(2);
    } finally { revoked.stop(); }
  } finally { client.stop(); vi.useRealTimers(); }
});

test('offline suspension aborts the pending transport and cannot flush after reconnection without a new generation', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  let release!: (response: Response) => void;
  const request = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/collection')) return json({ generation: randomUUID() });
    signal = options?.signal;
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  const client = new BrowserDiagnostics({ fetch: request });
  try {
    await client.start(); client.emit(event, context);
    const pending = client.flush(); client.suspend();
    expect(signal?.aborted).toBe(true);
    release(json({ accepted: 1, dropped: 0 })); await pending;
    client.emit(event, context); await client.flush();
    expect(request).toHaveBeenCalledTimes(2);
  } finally { client.stop(); vi.useRealTimers(); }
});
