import type { INetworkConditionService } from '@univerjs-pro/collaboration-client';
import { distinctUntilChanged, map } from 'rxjs';
import type { OfflineAccess } from './OfflineAccess.ts';

/** SDK connectivity follows the same verified gate as HTTP and sockets.
 * A browser's online event alone cannot authorize a prepared editor to sync.
 */
export class PreparedNetworkCondition implements INetworkConditionService {
  private access: OfflineAccess;
  readonly online$;
  constructor(access: OfflineAccess) {
    this.access = access;
    this.online$ = access.state$.pipe(
      map(() => this.online),
      distinctUntilChanged(),
    );
  }
  get online() {
    try {
      this.access.assertRemote(this.access.state.epoch, 'read');
      return true;
    } catch {
      return false;
    }
  }
}
