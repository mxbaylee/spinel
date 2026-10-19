import { Observable, Subscriber, Subscription } from 'rxjs';
import type { OfflineAccess } from './OfflineAccess.ts';

/**
 * Final transport fence, not an early interceptor. The adapter must classify
 * the request against its immutable unit and wrap a transport that starts on
 * subscription. A queued/retried old subscription never inherits a new epoch.
 */
export function remoteRequest<T>(
  access: OfflineAccess,
  mode: 'read' | 'write',
  send: () => Observable<T>,
): Observable<T> {
  const epoch = access.state.epoch;
  return new Observable<T>((observer) => {
    const lifetime = new Subscription();
    observer.add(lifetime);
    const assert = () => access.assertRemote(epoch, mode);
    try {
      assert();
      lifetime.add(
        access.state$.subscribe(() => {
          try {
            assert();
          } catch (error) {
            observer.error(error);
          }
        }),
      );
      if (observer.closed) return;
      const source = send();
      // A custom source factory could itself yield a newer access decision.
      assert();
      const receiver = new Subscriber<T>({
        next(value) {
          try {
            assert();
            observer.next(value);
          } catch (error) {
            observer.error(error);
          }
        },
        error(error: unknown) {
          observer.error(error);
        },
        complete() {
          observer.complete();
        },
      });
      // Register before subscribe: a synchronous next handler can lock access
      // while the source is still setting itself up and must see closed=true.
      lifetime.add(receiver);
      source.subscribe(receiver);
    } catch (error) {
      observer.error(error);
    }
  });
}
