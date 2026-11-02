import { renameSync, writeFileSync } from 'node:fs';

type Lifecycle = 'page-crash' | 'page-close' | 'context-close' | 'browser-disconnected';
type Failure =
  Lifecycle | 'operation' | 'input-observation' | 'trace' | 'detach' | 'fixture-cleanup';

/** Node-side observations survive a test-body timeout without querying the renderer.
 * This is diagnostic evidence only: it cannot replace native acceptance results. */
export function callbackProgress(path: string) {
  const started = performance.now();
  let cleanupExpected = false;
  let phase = 'fixture';
  const events: Array<{
    atMs: number;
    phase: string;
    kind: string;
    count?: number;
    expected?: boolean;
  }> = [];
  let firstFailure: { atMs: number; phase: string; kind: string } | null = null;
  let droppedEvents = 0;
  let terminal: string | null = null;
  let persistenceFailure: { atMs: number; phase: string; code: string } | null = null;
  const record = (kind: string, extra: { count?: number; expected?: boolean } = {}) => {
    events.push({ atMs: performance.now() - started, phase, kind, ...extra });
    // Fixed memory/disk bound even if a broken target emits repeated lifecycle events.
    if (events.length > 128) {
      events.shift();
      droppedEvents++;
    }
    try {
      // Keep the previous complete checkpoint if a write or rename fails. The
      // fixed temporary path bounds abandoned storage to one additional file.
      writeFileSync(
        `${path}.tmp`,
        JSON.stringify({
          schema: 1,
          phase,
          firstFailure,
          persistenceFailure,
          terminal,
          droppedEvents,
          events,
        }) + '\n',
      );
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      persistenceFailure ??= {
        atMs: performance.now() - started,
        phase,
        code: ['ENOSPC', 'ENOENT', 'EACCES', 'EIO', 'EROFS', 'EMFILE', 'ENFILE', 'EISDIR'].includes(
          code ?? '',
        )
          ? code!
          : 'unknown',
      };
      // Never throw from a lifecycle listener or bypass the owned-resource
      // cleanup. The test body/terminal hook reject missing evidence afterward.
    }
  };
  const fail = (kind: string) => {
    firstFailure ??= { atMs: performance.now() - started, phase, kind };
    record(kind);
  };
  record('started');
  return {
    phase(name: string, count?: number) {
      phase = name;
      record('phase', count === undefined ? {} : { count });
    },
    failed(kind: Failure) {
      fail(kind);
    },
    lifecycle(kind: Lifecycle) {
      const expected = cleanupExpected && (kind === 'page-close' || kind === 'context-close');
      if (!expected) firstFailure ??= { atMs: performance.now() - started, phase, kind };
      record(kind, { expected });
    },
    cleanup() {
      cleanupExpected = true;
      phase = 'fixture-cleanup';
      record('phase');
    },
    terminal(status: string) {
      terminal = status;
      if (status !== 'passed') fail(status);
      else record('terminal');
    },
    get firstFailure() {
      return firstFailure;
    },
    get persistenceFailure() {
      return persistenceFailure;
    },
  };
}
