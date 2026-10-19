import { InterceptorManager } from '@univerjs/core';
import type { IInterceptor, IMutationInfo } from '@univerjs/core';
import type { CompressMutationService } from '@univerjs-pro/collaboration';
import type { RecoveryLedger } from './RecoveryLedger.ts';

const observed = new WeakSet<object>();

type Manager = CompressMutationService['interceptor'];
type Points = ReturnType<Manager['getInterceptPoints']>;
type Filter = Parameters<Manager['fetchThroughInterceptors']>[1];
type Mutations = IMutationInfo[] | null | undefined | void;
type Observer = {
  apply(stage: 'input' | 'output', value: Mutations): void;
  failed(): void;
};

/** Public manager facade: preserve the caller's exact filter and the original
 * composed function, including handlers that terminate without calling next.
 * Only the declared, mutable interceptor property is replaced; no SDK internals
 * or Pro implementation are inspected or changed. The optional ledger enforces
 * singleton provenance in the bounded fixture; it never approves remote access.
 */
export function observeCompression(
  service: Pick<CompressMutationService, 'interceptor'>,
  observer: Observer,
  guard?: Pick<RecoveryLedger, 'beginTransform' | 'finishTransform' | 'rejectTransform'>,
) {
  if (observed.has(service)) throw new Error('Compression diagnostics are already installed.');
  observed.add(service);
  const original = service.interceptor;
  let active = true;
  let disposed = false;
  const notify = (callback: () => void) => {
    if (!active || disposed) return;
    try {
      callback();
    } catch {
      try {
        observer.failed();
      } catch {
        /* passive */
      }
    }
  };
  class ObservedManager extends InterceptorManager<Points> {
    constructor() {
      super(original.getInterceptPoints());
    }
    override getInterceptPoints() {
      return original.getInterceptPoints();
    }
    override intercept<T extends IInterceptor<unknown, unknown>>(point: T, interceptor: T) {
      return original.intercept(point, interceptor);
    }
    override fetchThroughInterceptors<T, C>(point: IInterceptor<T, C>, filter?: Filter) {
      const pipeline = original.fetchThroughInterceptors(point, filter);
      if (!Object.is(point, original.getInterceptPoints().COMPRESS_MUTATION_APPLY)) return pipeline;
      return (value: T | null | undefined | void, context: C) => {
        // A cached guarded function must never become an unguarded replay path
        // after its editor has removed the facade. Passive observations may stop.
        const assertOwned = () => {
          if (guard && (!active || disposed || service.interceptor !== facade))
            guard.rejectTransform();
        };
        assertOwned();
        notify(() => observer.apply('input', value as Mutations));
        try {
          const token = guard?.beginTransform(value as IMutationInfo[]);
          assertOwned();
          const result = pipeline(value, context);
          notify(() => observer.apply('output', result as Mutations));
          assertOwned();
          if (token) guard!.finishTransform(token, result as IMutationInfo[]);
          assertOwned();
          return result;
        } catch (error) {
          notify(() => observer.failed());
          if (guard) {
            try {
              guard.rejectTransform();
            } catch {
              // Latch access failure while preserving the original thrown error.
            }
          }
          throw error;
        }
      };
    }
    override dispose() {
      disposed = true;
      original.dispose();
      super.dispose();
    }
  }
  const facade = new ObservedManager();
  service.interceptor = facade;
  return () => {
    if (!active) return;
    active = false;
    observed.delete(service);
    if (service.interceptor === facade) service.interceptor = original;
  };
}
