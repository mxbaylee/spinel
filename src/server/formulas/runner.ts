import { Worker } from 'node:worker_threads';
import type { FormulaDefinition, FormulaResult, FormulaSource } from '@spinel/doc-formulas';

export const FORMULA_DEADLINE_MS = 5000;
let active = false;

/** No queue, one worker, bounded heap, and real termination on timeout or completion. */
export async function runFormula(
  definition: FormulaDefinition,
  sources: FormulaSource[],
  deadline = FORMULA_DEADLINE_MS,
): Promise<FormulaResult> {
  if (active) return { ok: false, reason: 'busy' };
  active = true;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { definition, sources },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
      // Vitest/tsx loader flags belong to the parent; Node 24 runs this TS directly.
      execArgv: [],
    });
    return await new Promise<FormulaResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), deadline);
      worker!.once('message', (value: FormulaResult) => resolve(value));
      worker!.once('error', () => resolve({ ok: false, reason: 'unavailable' }));
      worker!.once('exit', () => resolve({ ok: false, reason: 'unavailable' }));
    });
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    active = false;
  }
}
