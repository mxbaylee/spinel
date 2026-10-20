import { parentPort, workerData } from 'node:worker_threads';
import { evaluateFormula } from '@spinel/doc-formulas';

if (parentPort) {
  try {
    parentPort.postMessage(await evaluateFormula(workerData.definition, workerData.sources));
  } catch {
    parentPort.postMessage({ ok: false, reason: 'invalid-formula' });
  }
}
