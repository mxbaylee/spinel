import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { crashTransition, durableControlFailure } from './supervisor-test-control.ts';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test.each(['throw', 'reject'])(
  'a pre-barrier control %s preserves action, stage, journal and cause without waiting for timeout',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'spinel-crash-control-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      join(root, 'journal.json'),
      JSON.stringify({
        phase: 'paused',
        lastFailure: 'child-exited',
        authority: 'must-not-appear',
      }),
    );
    vi.useFakeTimers();
    const started = Date.now();
    const child = new EventEmitter() as ChildProcess;
    const original = new Error('Maintenance could not complete this operation.');
    const contextual = durableControlFailure(
      root,
      {
        phase: 'running',
        stage: 'transition',
        action: 'resume',
      },
      original,
    );
    const transition = crashTransition(child, 'running', () => {
      if (mode === 'throw') throw contextual;
      return Promise.reject(contextual);
    });
    const failure = await transition.reached.catch((error) => error);
    expect(failure).toBe(contextual);
    expect(failure.cause).toBe(original);
    expect(JSON.parse(failure.message.slice('Durable phase control failed: '.length))).toEqual({
      phase: 'running',
      stage: 'transition',
      action: 'resume',
      journal: { phase: 'paused', lastFailure: 'child-exited' },
    });
    expect(failure.message).not.toContain('must-not-appear');
    expect(Date.now()).toBe(started);
    expect(child.listenerCount('message')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await transition.settled;
    // A late message cannot turn the already-rejected wait into success.
    child.emit('message', { barrier: 'running' });
    await expect(transition.reached).rejects.toBe(contextual);
  },
);

test('the reached barrier tolerates the expected crash rejection and cancels its message wait', async () => {
  vi.useFakeTimers();
  const child = new EventEmitter() as ChildProcess;
  let reject!: (error: Error) => void;
  const control = new Promise<void>((_resolve, rejectControl) => {
    reject = rejectControl;
  });
  const transition = crashTransition(child, 'running', () => control);
  child.emit('message', { barrier: 'paused' });
  expect(child.listenerCount('message')).toBe(1);
  expect(vi.getTimerCount()).toBe(1);
  child.emit('message', { barrier: 'running' });
  await transition.reached;
  expect(child.listenerCount('message')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  reject(new Error('Control connection ended after the intended SIGKILL.'));
  await expect(transition.settled).resolves.toBeUndefined();
});

test('the unchanged message deadline cleans up even when the control rejects only afterward', async () => {
  vi.useFakeTimers();
  const child = new EventEmitter() as ChildProcess;
  let reject!: (error: Error) => void;
  const control = new Promise<void>((_resolve, rejectControl) => {
    reject = rejectControl;
  });
  const transition = crashTransition(child, 'running', () => control);
  const failed = transition.reached.catch((error) => error);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(child.listenerCount('message')).toBe(1);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await failed).message).toBe('Fixture message timed out.');
  expect(child.listenerCount('message')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  reject(new Error('Late control rejection.'));
  await expect(transition.settled).resolves.toBeUndefined();
});
