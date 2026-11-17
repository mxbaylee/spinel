import type { ServerEvidence } from './fixture-evidence.ts';

// 🔌 SPN-166: a connection reset on a test's own HTTP client says nothing about
// the server. Pair every reset with the owned server's process state at that
// moment so one failed CI attempt separates "the process died or restarted"
// from "a live server dropped one connection". Content-free: no cookies, ids,
// query strings, error text or server output are retained, only allowlisted
// facts and byte counts. The full evidence file stays in the CI artifact.

const resetPattern = /ECONNRESET|ERR_CONNECTION_RESET/;
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export type ResetServerFacts =
  | { available: false }
  | {
      available: true;
      pid: number | null;
      ownerPid: number;
      ready: boolean;
      exited: boolean;
      unexpectedExit: boolean;
      closed: boolean;
      /** Whether the wrapper recorded a failure; its message text is not kept. */
      failed: boolean;
      exitCode: number | null;
      signal: string | null;
      stderrBytes: number;
      stdoutBytes: number;
      /** The wrapper writes every 250 ms; a large age means the owner stopped. */
      evidenceAgeMs: number;
    };

export type ResetDiagnostic = {
  kind: 'econnreset-diagnostic';
  project: string;
  file: string;
  line: number;
  attempt: number;
  status: string;
  /** The failing client call, for example `GET /api/items/<id>/sheet`. */
  request: string | null;
  server: ResetServerFacts;
};

/** Method and normalized path of the request Playwright's call log names. */
export function resetRequest(message: string): string | null {
  const call = /→ ([A-Z]+) (\S+)/.exec(message.replace(ansi, ''));
  if (!call) return null;
  let path = call[2];
  try {
    path = new URL(path).pathname;
  } catch {
    path = path.split('?')[0];
  }
  return `${call[1]} ${path.replace(uuid, '<id>')}`.slice(0, 160);
}

export function isReset(errors: readonly { message?: string }[]): boolean {
  return errors.some((error) => resetPattern.test((error.message ?? '').replace(ansi, '')));
}

export function serverFacts(evidence: ServerEvidence | undefined, now: number): ResetServerFacts {
  if (!evidence) return { available: false };
  return {
    available: true,
    pid: evidence.pid,
    ownerPid: evidence.ownerPid,
    ready: evidence.ready,
    exited: evidence.exited,
    unexpectedExit: evidence.unexpectedExit,
    closed: evidence.closed,
    exitCode: evidence.exitCode,
    signal: evidence.signal,
    failed: evidence.firstFailure !== null,
    stderrBytes: evidence.stderr.bytes,
    stdoutBytes: evidence.stdout.bytes,
    evidenceAgeMs: Math.max(0, now - evidence.updatedAt),
  };
}

export function resetDiagnostic(input: {
  project: string;
  file: string;
  line: number;
  attempt: number;
  status: string;
  errors: readonly { message?: string }[];
  evidence: ServerEvidence | undefined;
  now: number;
}): ResetDiagnostic | undefined {
  const message = input.errors.find((error) =>
    resetPattern.test((error.message ?? '').replace(ansi, '')),
  )?.message;
  if (message === undefined) return undefined;
  return {
    kind: 'econnreset-diagnostic',
    project: input.project,
    file: input.file,
    line: input.line,
    attempt: input.attempt,
    status: input.status,
    request: resetRequest(message),
    server: serverFacts(input.evidence, input.now),
  };
}

const keepLast = 50;

/** Append one diagnostic to a saved list, keeping only the newest entries. */
export function appendDiagnostic(saved: unknown, next: ResetDiagnostic): ResetDiagnostic[] {
  const all = Array.isArray(saved) ? (saved as ResetDiagnostic[]) : [];
  return [...all, next].slice(-keepLast);
}
