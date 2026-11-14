/** Test-only coordination and bounded diagnostics for supervisor crash fixtures. */
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MaintenancePhase } from '../../shared/maintenance.ts';

// Journal fields are machine codes, never arbitrary exception text or payloads.
export const diagnosticCode = (value: unknown) =>
  value === null
    ? null
    : typeof value === 'string' && /^[a-z-]{1,64}$/.test(value)
      ? value
      : 'invalid';

export function durableControlFailure(
  root: string,
  context: {
    phase: MaintenancePhase;
    stage: 'setup' | 'transition' | 'reconcile';
    action: 'verify' | 'start' | 'resume' | 'pause' | 'stop' | 'status';
  },
  cause: unknown,
) {
  let journal: { phase: string; lastFailure: string | null } | 'unavailable' = 'unavailable';
  try {
    const state = JSON.parse(readFileSync(join(root, 'journal.json'), 'utf8'));
    journal = {
      phase: diagnosticCode(state.phase) ?? 'invalid',
      lastFailure: diagnosticCode(state.lastFailure),
    };
  } catch {
    /* Preserve the control failure even if its journal cannot be read. */
  }
  return new Error(`Durable phase control failed: ${JSON.stringify({ ...context, journal })}`, {
    cause,
  });
}

/** Observe the durable barrier before tolerating the intended SIGKILL RPC error. */
export function crashTransition(
  child: ChildProcess,
  phase: MaintenancePhase,
  control: () => Promise<unknown>,
) {
  let observed = false;
  let finish!: (failure: { error: unknown } | null) => void;
  const reached = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish({ error: new Error('Fixture message timed out.') }),
      10_000,
    );
    function receive(value: unknown) {
      if (value && typeof value === 'object' && 'barrier' in value && value.barrier === phase) {
        observed = true;
        finish(null);
      }
    }
    finish = (failure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', receive);
      if (failure) reject(failure.error);
      else resolve();
    };
    child.on('message', receive);
  });
  const settled = (async () => {
    try {
      await control();
    } catch (error) {
      // A pre-barrier failure must beat the message timeout with its original
      // action/journal/cause. Post-barrier rejection is expected after SIGKILL.
      if (!observed) finish({ error });
    }
  })();
  return { reached, settled };
}
