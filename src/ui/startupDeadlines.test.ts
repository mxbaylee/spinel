import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  ITEM_REQUEST_DEADLINE_MS,
  NAVIGATION_DEADLINE_MS,
  requireBrowserOnline,
} from '../../web/offline/deadlines.ts';

// Regression contract (SPN-090 own-phone run): offline or stalled starts must not hang
// without an answer, and a status line names the step a slow start is waiting on.

test('a browser that knows it is offline fails like a network failure; online proves nothing', () => {
  expect(() => requireBrowserOnline({ onLine: false })).toThrow(TypeError);
  expect(() => requireBrowserOnline({ onLine: true })).not.toThrow();
  expect(() => requireBrowserOnline({})).not.toThrow();
  expect(() => requireBrowserOnline(undefined)).not.toThrow();
});

test('the deadlines keep a page load shorter than an item request', () => {
  expect(NAVIGATION_DEADLINE_MS).toBe(8000);
  expect(ITEM_REQUEST_DEADLINE_MS).toBe(15_000);
});

type Line = {
  role?: string;
  textContent: string;
  removed: boolean;
  style: { cssText: string };
  setAttribute(name: string, value: string): void;
  remove(): void;
};
let lines: Line[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  lines = [];
  const document = {
    createElement: () => {
      const line: Line = {
        textContent: '',
        removed: false,
        style: { cssText: '' },
        setAttribute: (name, value) => {
          if (name === 'role') line.role = value;
        },
        remove: () => {
          line.removed = true;
        },
      };
      return line;
    },
    body: { append: (line: Line) => lines.push(line) },
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a slow start stays silent at first, then names the step it waits on', async () => {
  const { startupStage } = await import('../../web/startupStage.ts');
  startupStage('sign-in check');
  vi.advanceTimersByTime(7000);
  expect(lines).toHaveLength(0);
  vi.advanceTimersByTime(2000);
  expect(lines).toHaveLength(1);
  expect(lines[0]?.role).toBe('status');
  expect(lines[0]?.textContent).toBe('Still starting: sign-in check (9 s)');
});

test('importing the module starts no timer; the first named step does', async () => {
  const { startupStage } = await import('../../web/startupStage.ts');
  vi.advanceTimersByTime(20_000);
  expect(lines).toHaveLength(0);
  startupStage('app code');
  vi.advanceTimersByTime(1000);
  expect(lines).toHaveLength(1);
});

test('a finished start removes the line and stays silent', async () => {
  const { startupDone, startupStage } = await import('../../web/startupStage.ts');
  startupStage('first');
  vi.advanceTimersByTime(9000);
  expect(lines).toHaveLength(1);
  startupDone();
  expect(lines[0]?.removed).toBe(true);
  startupStage('late');
  vi.advanceTimersByTime(5000);
  expect(lines).toHaveLength(1);
  expect(lines[0]?.textContent).not.toContain('late');
});

test('a start that finishes before the delay never shows a line', async () => {
  const { startupDone, startupStage } = await import('../../web/startupStage.ts');
  startupStage('first');
  vi.advanceTimersByTime(3000);
  startupDone();
  vi.advanceTimersByTime(20_000);
  expect(lines).toHaveLength(0);
});
