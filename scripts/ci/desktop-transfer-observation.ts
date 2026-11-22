import type { IncomingMessage, ServerResponse } from 'node:http';

/** Fixture-only, bounded transfer lifetimes; never retain paths, headers or bodies. */
export function desktopTransferObservation(admitted: (response: ServerResponse) => boolean) {
  const requests: {
    ordinal: number;
    route: string;
    startedMs: number;
    admittedAtStart: number[];
    status?: number;
    finishedMs?: number;
    closedMs?: number;
    admittedAtClose?: boolean;
  }[] = [];
  const tracked = new Map<ServerResponse, number>();
  const started = performance.now();
  let total = 0;
  let dropped = 0;
  let unreadable = 0;
  const safely = (work: () => void) => {
    try {
      work();
    } catch {
      unreadable++;
    }
  };
  return {
    observe(request: Pick<IncomingMessage, 'url'>, response: ServerResponse) {
      safely(() => {
        const route = request.url
          ?.split('?')[0]
          .match(
            /\/(offline-bundle|offline-recovery|export|import|copy|archive-import|archive-export)$/,
          )?.[1];
        if (!route) return;
        const ordinal = ++total;
        if (requests.length === 256) {
          dropped++;
          return;
        }
        const admittedAtStart: number[] = [];
        for (const [previous, id] of tracked) {
          if (admitted(previous)) admittedAtStart.push(id);
          else if (previous.destroyed || previous.writableFinished) tracked.delete(previous);
        }
        const record: (typeof requests)[number] = {
          ordinal,
          route,
          startedMs: performance.now() - started,
          admittedAtStart,
        };
        requests.push(record);
        tracked.set(response, ordinal);
        response.once('finish', () =>
          safely(() => {
            record.status = response.statusCode;
            record.finishedMs = performance.now() - started;
          }),
        );
        response.once('close', () =>
          safely(() => {
            record.status = response.headersSent ? response.statusCode : undefined;
            record.closedMs = performance.now() - started;
            record.admittedAtClose = admitted(response);
          }),
        );
      });
    },
    snapshot() {
      return { total, dropped, unreadable, requests: structuredClone(requests) };
    },
  };
}
