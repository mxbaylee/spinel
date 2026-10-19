import { observeCompression } from './offline/observeCompression.ts';
import { CompressMutationService } from '@univerjs-pro/collaboration';
import { ProbeLocalCache } from './ProbeLocalCache.ts';
import { ICommandService } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import { ILocalCacheService } from '@univerjs-pro/collaboration-client';
import type { IUnitCacheData } from '@univerjs-pro/collaboration-client';

type RecoveryProbe = {
  hostCache: boolean;
  ledger: () =>
    | {
        diagnostics: {
          failed: boolean;
          truncated: boolean;
          unmatchedInputs: number;
          unmatchedOutputs: number;
        };
        status: string;
        reads: number;
        writes: number;
        held?: 'read' | 'write';
        facadeLoaded: boolean;
        collaborationReady: boolean;
        accounting?: { expected: number; applied: number; phase: string };
      }
    | undefined;
  release: () => void;
  serverConfirmation?: { sid: string; reqId: number };
  beforeLoad: IUnitCacheData | null | undefined;
  read: () => Promise<IUnitCacheData | null | undefined>;
};
declare global {
  interface Window {
    __spinelRecoveryProbe?: RecoveryProbe;
  }
}

/** Temporary fixture instrumentation through public cache reads and event streams only. */
export async function observeOfflineRecovery(
  univer: Univer,
  unitId: string,
  userId: string,
  document = false,
) {
  if (
    !import.meta.env.SPINEL_RECOVERY_PROBE ||
    location.origin !== 'https://localhost:3103' ||
    new URLSearchParams(location.search).get('offline-probe') !== '1'
  )
    return () => {};
  const stops: (() => void)[] = [];
  const observerId = crypto.randomUUID();
  let sequence = 0;
  const trace = (event: string, project: () => unknown) => {
    const current = ++sequence;
    try {
      console.log(
        JSON.stringify({
          recoveryDocEvent: event,
          observerId,
          sequence: current,
          value: structuredClone(project()),
        }),
      );
    } catch (error) {
      // An observer must not interrupt the mutation it is measuring.
      console.log(
        JSON.stringify({
          recoveryDocEvent: 'trace failure',
          observerId,
          sequence: current,
          value: String(error),
        }),
      );
    }
  };
  try {
    if (document) {
      const { DocStateEmitService, DocStateChangeManagerService, RichTextEditingMutation } =
        await import('@univerjs/docs');
      const injector = univer.__getInjector();
      // Passive public observers. Before-command means attempted execution only;
      // correlate with state/cache events and exact browser/server content checks.
      const commands = injector.get(ICommandService).beforeCommandExecuted((command, options) => {
        const params = command.params as Record<string, unknown> | undefined;
        if (command.id === RichTextEditingMutation.id && params?.unitId === unitId)
          trace('before text mutation', () => ({
            unitId: params.unitId,
            actions: params.actions,
            trigger: params.trigger,
            segmentId: params.segmentId,
            debounce: params.debounce,
            noHistory: params.noHistory,
            isSync: params.isSync,
            syncer: params.syncer,
            options: {
              fromCollab: options?.fromCollab,
              fromChangeset: options?.fromChangeset,
              onlyLocal: options?.onlyLocal,
              syncOnly: options?.syncOnly,
              recoveredIdentity: options?.spinelRecoveredIdentity,
            },
          }));
      });
      stops.push(() => commands.dispose());
      const raw = injector.get(DocStateEmitService).docStateChangeParams$.subscribe((value) => {
        if (value?.unitId === unitId)
          trace('raw state', () => ({
            unitId: value.unitId,
            trigger: value.trigger,
            segmentId: value.segmentId,
            actions: value.redoState.actions,
            debounce: value.debounce,
            noHistory: value.noHistory,
            isSync: value.isSync,
            syncer: value.syncer,
          }));
      });
      stops.push(() => raw.unsubscribe());
      const grouped = injector
        .get(DocStateChangeManagerService)
        .docStateChange$.subscribe((value) => {
          if (value?.unitId === unitId)
            trace('grouped state', () => ({
              unitId: value.unitId,
              trigger: value.trigger,
              segmentId: value.segmentId,
              actions: value.redoState.actions,
              debounce: value.debounce,
              noHistory: value.noHistory,
            }));
        });
      stops.push(() => grouped.unsubscribe());
    }
    const cache = univer.__getInjector().get(ILocalCacheService);
    if (cache instanceof ProbeLocalCache) {
      await cache.prepareRecovery();
      if (cache.recovery) {
        const compression = univer.__getInjector().get(CompressMutationService);
        stops.push(
          observeCompression(
            compression,
            {
              apply: (stage, value) => cache.recovery!.observeApply(stage, value),
              failed: () => cache.recovery!.observeApplyFailure(),
            },
            cache.recovery.ledger,
          ),
        );
      }
    }
    const read = async () =>
      structuredClone(
        (await (cache instanceof ProbeLocalCache && cache.recovery
          ? cache.inspectOfflineData(unitId, userId)
          : cache.loadOfflineData(unitId, userId))) ?? null,
      );
    const probe = {
      hostCache: cache instanceof ProbeLocalCache,
      beforeLoad: await read(),
      read,
      ledger: () => (cache instanceof ProbeLocalCache ? cache.recovery?.evidence() : undefined),
      release: () => {
        if (!(cache instanceof ProbeLocalCache) || !cache.recovery)
          throw new Error('Ledger probe unavailable.');
        cache.recovery.release();
      },
    };
    window.__spinelRecoveryProbe = probe;
    return () => {
      stops.forEach((stop) => stop());
      if (window.__spinelRecoveryProbe === probe) delete window.__spinelRecoveryProbe;
    };
  } catch (error) {
    stops.forEach((stop) => stop());
    throw error;
  }
}
