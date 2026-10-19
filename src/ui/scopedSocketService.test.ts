import { expect, test, vi } from 'vitest';
import { Subject } from 'rxjs';
import type { ICollaborationSocket } from '@univerjs-pro/collaboration-client';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import { scopedSocketService } from '../../web/offline/ScopedSocketService.ts';

// Model only the declared extension contract here. The HTTPS browser fixture
// separately verifies that the real pinned SDK invokes these public hooks.
const sdk = vi.hoisted(() => ({
  ticket: async () => 'opaque',
  create: (_url: string): ICollaborationSocket | null => null,
  bypass: undefined as undefined | (() => Promise<ICollaborationSocket>),
}));
vi.mock('@univerjs-pro/collaboration-client-ui', () => ({
  BrowserCollaborationSocketService: class {
    async createSocket(url: string) {
      if (sdk.bypass) return sdk.bypass();
      return this._doCreateSocket(this._createSocketURL(url, await this._getSessionTicket()));
    }
    _getSessionTicket() {
      return sdk.ticket();
    }
    _createSocketURL(url: string, ticket: string) {
      return `${url}?sessionTicket=${ticket}`;
    }
    _doCreateSocket(url: string) {
      return sdk.create(url);
    }
  },
}));
async function fixture() {
  const scope = {
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'sheet' as const,
    access: 'owner' as const,
    sdkVersion: '1.1.0' as const,
    schema: 1 as const,
    revisionOffset: 0,
  };
  const access = new OfflineAccess(scope, async () => ({ ...scope, restoring: false }));
  access.completeRecovery();
  await access.validate();
  sdk.bypass = undefined;
  sdk.ticket = async () => 'opaque';
  const urls: string[] = [];
  const close = vi.fn();
  const socket: ICollaborationSocket = {
    memberID: 'member',
    open$: new Subject(),
    close$: new Subject(),
    error$: new Subject(),
    message$: new Subject(),
    send: vi.fn(),
    close,
  };
  sdk.create = (url) => {
    urls.push(url);
    return socket;
  };
  const Service = scopedSocketService(access);
  // The mocked base has no injected dependencies; production uses the SDK injector.
  const service = new (Service as unknown as new () => InstanceType<typeof Service>)();
  return { access, service, urls, socket, close };
}
const endpoint = 'wss://spinel.example/universer-api/comb/connect';
test('stale ticket completion cannot create a socket, even after fresh validation', async () => {
  const f = await fixture();
  const ticket = Promise.withResolvers<string>();
  sdk.ticket = () => ticket.promise;
  const pending = f.service.createSocket(endpoint);
  await expect(f.service.createSocket(endpoint)).rejects.toThrow('already in progress');
  f.access.networkLost();
  await f.access.validate();
  ticket.resolve('opaque');
  await expect(pending).rejects.toThrow();
  expect(f.urls).toEqual([]);
  sdk.ticket = async () => 'fresh';
  const socket = await f.service.createSocket(endpoint);
  const url = new URL(f.urls[0]);
  expect(url.searchParams.get('unitID')).toBe('unit');
  expect(url.searchParams.get('spinelAccount')).toBe('owner');
  expect(socket).not.toBe(f.socket);
  f.access.lock('Sign out.');
  expect(f.close).toHaveBeenCalledTimes(1);
  f.access.dispose();
});
test('hook bypass and access loss together still close the returned socket', async () => {
  const f = await fixture();
  const returned = Promise.withResolvers<ICollaborationSocket>();
  sdk.bypass = () => returned.promise;
  const pending = f.service.createSocket(endpoint);
  f.access.lock('Account changed.');
  returned.resolve(f.socket);
  await expect(pending).rejects.toThrow();
  expect(f.close).toHaveBeenCalledTimes(1);
  f.access.dispose();
  sdk.bypass = undefined;
});
test('hook bypass while authorized is also rejected and closed', async () => {
  const f = await fixture();
  sdk.bypass = async () => f.socket;
  await expect(f.service.createSocket(endpoint)).rejects.toThrow('bypassed');
  expect(f.close).toHaveBeenCalledTimes(1);
  f.access.dispose();
  sdk.bypass = undefined;
});
test.each([
  'wss://other.example/universer-api/comb/connect',
  endpoint + '?unitID=other',
  endpoint + '/other',
])('rejects unexpected endpoint %s', async (endpoint) => {
  const f = await fixture();
  await expect(f.service.createSocket(endpoint)).rejects.toThrow();
  expect(f.urls).toEqual([]);
  f.access.dispose();
});
