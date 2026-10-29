import { randomUUID } from 'node:crypto';
import type { DiagnosticSink } from '@spinel/diagnostics';
import { diagnosticsConfiguration } from './configuration.ts';
import { DiagnosticsStore } from './store.ts';

/** Same bounded diagnostics store, independent of the child that maintenance can stop. */
export function supervisorDiagnostics(databasePath: string, image?: string) {
  const store = new DiagnosticsStore({
    ...diagnosticsConfiguration(databasePath, image),
    secondaryWriter: true,
  });
  const runId = randomUUID();
  let reported = '';
  let closed = false;
  const losses = () => {
    const dropped = store.status().dropped;
    const encoded = JSON.stringify(dropped);
    if (encoded === reported || !Object.values(dropped).some((count) => count > 0)) return;
    reported = encoded;
    store.emit(
      { name: 'diagnostics.writer-loss', details: { writer: 'supervisor', ...dropped } },
      { component: 'server', runId },
    );
  };
  const sink: DiagnosticSink = (event, context) => {
    // All this writer's events are process observations, never inferred account activity.
    store.emit(event, { ...context, runId });
    losses();
  };
  return {
    sink,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await store.drainMaintenance();
        losses();
        await store.drainMaintenance();
        const dropped = store.status().dropped;
        if (Object.values(dropped).some((count) => count > 0))
          console.error('Supervisor diagnostics process-lifetime drops:', JSON.stringify(dropped));
      } catch {
        console.error('Supervisor diagnostics could not finish its bounded observation flush.');
      } finally {
        try {
          await store.close();
        } catch {
          console.error('Supervisor diagnostics could not close its observation store.');
        }
      }
    },
  };
}
