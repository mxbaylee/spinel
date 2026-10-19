import { BrowserCollaborationSocketService } from '@univerjs-pro/collaboration-client-ui';
import type { ICollaborationSocket } from '@univerjs-pro/collaboration-client';
import type { OfflineAccess } from './OfflineAccess.ts';
import { scopedSocket } from './scopedSocket.ts';

/** Public extension points only; each asynchronous attempt owns one epoch. */
export function scopedSocketService(access: OfflineAccess) {
  return class ScopedSocketService extends BrowserCollaborationSocketService {
    private attempt?: { epoch: number; socket?: ICollaborationSocket };

    private assertAttempt() {
      if (!this.attempt) throw new Error('No prepared connection attempt.');
      access.assertRemote(this.attempt.epoch, 'read');
      return this.attempt;
    }
    override async createSocket(rawUrl: string) {
      // Protected SDK hooks do not take an attempt token. Never let overlapping
      // promises replace the scope consulted by an older pending ticket request.
      if (this.attempt) throw new Error('Prepared connection attempt already in progress.');
      const epoch = access.state.epoch;
      access.assertRemote(epoch, 'read');
      const url = new URL(rawUrl);
      const origin = new URL(access.scope.origin);
      origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
      if (
        url.origin !== origin.origin ||
        url.pathname !== '/universer-api/comb/connect' ||
        url.username ||
        url.password ||
        url.hash ||
        url.search
      )
        throw new Error('Unexpected prepared socket endpoint.');
      const attempt = { epoch, socket: undefined as ICollaborationSocket | undefined };
      this.attempt = attempt;
      let returned: Awaited<ReturnType<BrowserCollaborationSocketService['createSocket']>>;
      try {
        const socket = (returned = await super.createSocket(rawUrl));
        this.assertAttempt();
        if (socket && socket !== attempt.socket) {
          throw new Error('SDK bypassed the prepared socket factory.');
        }
        return socket;
      } catch (error) {
        if (returned && returned !== attempt.socket) returned.close();
        attempt.socket?.close();
        throw error;
      } finally {
        this.attempt = undefined;
      }
    }
    protected override async _getSessionTicket() {
      this.assertAttempt();
      const ticket = await super._getSessionTicket();
      this.assertAttempt();
      return ticket;
    }
    protected override _createSocketURL(url: string, ticket: string) {
      this.assertAttempt();
      const scoped = new URL(super._createSocketURL(url, ticket));
      scoped.searchParams.set('unitID', access.scope.unitId);
      scoped.searchParams.set('spinelAccount', access.scope.accountId);
      return scoped.toString();
    }
    protected override _doCreateSocket(url: string) {
      const attempt = this.assertAttempt();
      const socket = super._doCreateSocket(url);
      if (!socket) return null;
      attempt.socket = scopedSocket(access, attempt.epoch, socket);
      this.assertAttempt();
      return attempt.socket;
    }
  };
}
