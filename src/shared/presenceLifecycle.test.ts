import { expect, test, vi } from 'vitest';
import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { IMember } from '@univerjs/protocol';

vi.mock('@univerjs-pro/collaboration-client', () => ({ CollaborationSessionService: class {} }));
vi.mock('@univerjs/engine-render', () => ({ IRenderManagerService: Symbol('render') }));
vi.mock('@univerjs/docs-ui', () => ({ DocSelectionRenderService: class {} }));

import { watchPresence } from '../../web/Collaborators.tsx';

function fixture() {
  const cursorStop = vi.fn();
  const membershipStop = vi.fn();
  const subscribe = vi.fn(() => ({ unsubscribe: cursorStop }));
  const members = vi.fn((_id: string, _publish: (members: IMember[]) => void) => ({
    dispose: membershipStop,
  }));
  const publish = vi.fn();
  const unavailable = vi.fn();
  const pending = Promise.withResolvers<{ event$: { subscribe: typeof subscribe } }>();
  const service = { requireSession: vi.fn(() => pending.promise) };
  const univer = { __getInjector: () => ({ get: () => service }) } as unknown as Univer;
  const api = {
    getCollaboration: () => ({ subscribeCollaborators: members }),
  } as unknown as FUniver;
  return {
    pending,
    subscribe,
    members,
    cursorStop,
    membershipStop,
    unavailable,
    publish,
    start: () => watchPresence(univer, api, 'unit', publish, unavailable),
  };
}

test('presence returns a synchronous disposer while its connection is still pending', async () => {
  const f = fixture();
  const stop = f.start();
  expect(typeof stop).toBe('function');
  expect(f.members).not.toHaveBeenCalled();
  f.pending.resolve({ event$: { subscribe: f.subscribe } });
  await f.pending.promise;
  expect(f.members).toHaveBeenCalledOnce();
  expect(f.subscribe).toHaveBeenCalledOnce();
  stop();
  stop();
  expect(f.membershipStop).toHaveBeenCalledOnce();
  expect(f.cursorStop).toHaveBeenCalledOnce();
});

test('disposing while connecting prevents late subscriptions and notices', async () => {
  const f = fixture();
  f.start()();
  f.pending.resolve({ event$: { subscribe: f.subscribe } });
  await f.pending.promise;
  expect(f.members).not.toHaveBeenCalled();
  expect(f.subscribe).not.toHaveBeenCalled();
  expect(f.unavailable).not.toHaveBeenCalled();
});

test('a failed presence connection reports its own notice without rejecting editor setup', async () => {
  const f = fixture();
  const stop = f.start();
  f.pending.reject(new Error('Connection unavailable'));
  await vi.waitFor(() => expect(f.unavailable).toHaveBeenCalledOnce());
  expect(f.members).not.toHaveBeenCalled();
  stop();
});

test('a partially attached presence observer is cleaned up if cursor subscription fails', async () => {
  const f = fixture();
  f.members.mockImplementation((_id, callback) => {
    callback([{ memberID: 'member', userID: 'user', name: 'Collaborator', avatar: '' }]);
    return { dispose: f.membershipStop };
  });
  const stop = f.start();
  f.subscribe.mockImplementation(() => {
    throw new Error('Session closed');
  });
  f.pending.resolve({ event$: { subscribe: f.subscribe } });
  await vi.waitFor(() => expect(f.unavailable).toHaveBeenCalledOnce());
  expect(f.publish.mock.calls[0][0]).toHaveLength(1);
  expect(f.publish).toHaveBeenLastCalledWith([]);
  expect(f.membershipStop).toHaveBeenCalledOnce();
  stop();
  expect(f.membershipStop).toHaveBeenCalledOnce();
});

test('a rejected connection after disposal cannot publish a notice or clear a replacement editor', async () => {
  const f = fixture();
  f.start()();
  f.pending.reject(new Error('Session disposed'));
  await f.pending.promise.catch(() => {});
  await Promise.resolve();
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.unavailable).not.toHaveBeenCalled();
});
