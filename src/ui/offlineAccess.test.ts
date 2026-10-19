import { expect, test } from 'vitest';
import { OfflineAccess, OfflineConnectionError } from '../../web/offline/OfflineAccess.ts';
import type { OfflineScope, AccessProof } from '../../web/offline/OfflineAccess.ts';

const scope: OfflineScope = {
  origin: 'https://spinel.example',
  accountId: 'owner',
  itemId: 'item',
  unitId: 'generation',
  kind: 'doc',
  access: 'owner',
  sdkVersion: '1.1.0',
  schema: 1,
  revisionOffset: 4,
};
const proof = (): AccessProof => ({ ...scope, restoring: false });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('prepared local rights never grant network access; both recovery and fresh access are required', async () => {
  const input = { ...scope };
  const access = new OfflineAccess(input, async () => proof());
  input.accountId = 'another person';
  expect(access.scope.accountId).toBe('owner');
  expect(access.mayReadLocal).toBe(true);
  expect(access.mayEditLocal).toBe(false);
  expect(() => access.assertRemote(0, 'read')).toThrow();
  expect(await access.validate()).toBe(true);
  expect(access.state.phase).toBe('recovering');
  expect(() => access.assertRemote(access.state.epoch, 'read')).toThrow();
  access.completeRecovery();
  const epoch = access.state.epoch;
  expect(access.mayEditLocal).toBe(true);
  expect(() => access.assertRemote(epoch, 'read')).not.toThrow();
  access.networkLost();
  expect(access.mayEditLocal).toBe(true);
  expect(() => access.assertRemote(epoch, 'read')).toThrow();
  await access.validate();
  expect(() => access.assertRemote(epoch, 'read')).toThrow();
  expect(() => access.assertRemote(access.state.epoch, 'read')).not.toThrow();
  access.dispose();
});

test.each(['network lost', 'lock', 'dispose', 'recovery failed'])(
  'a late access response cannot reopen traffic after %s',
  async (event) => {
    const pending = deferred<AccessProof>();
    let signal!: AbortSignal;
    const access = new OfflineAccess(scope, (_scope, abort) => {
      signal = abort;
      return pending.promise;
    });
    access.completeRecovery();
    const validation = access.validate();
    const epoch = access.state.epoch;
    if (event === 'network lost') access.networkLost();
    else if (event === 'lock') access.lock('Signed out.');
    else if (event === 'dispose') access.dispose();
    else access.failRecovery('Original pending record could not be verified.');
    expect(signal.aborted).toBe(true);
    pending.resolve(proof());
    expect(await validation).toBe(false);
    expect(() => access.assertRemote(epoch, 'read')).toThrow();
    expect(() => access.assertRemote(access.state.epoch, 'read')).toThrow();
    if (event !== 'network lost') {
      expect(access.mayReadLocal).toBe(false);
      expect(access.mayEditLocal).toBe(false);
      expect(() => access.completeRecovery()).toThrow();
      expect(await access.validate()).toBe(false);
    }
    access.dispose();
  },
);

test.each([
  { accountId: 'other' },
  { itemId: 'other' },
  { unitId: 'replacement' },
  { access: 'viewer' },
  { kind: 'sheet' },
  { restoring: true },
  { revisionOffset: 5 },
  { sdkVersion: 'incompatible' },
])('changed identity/permissions stop local entry and remote replay: %j', async (changed) => {
  const access = new OfflineAccess(scope, async () => ({ ...proof(), ...changed }) as AccessProof);
  access.completeRecovery();
  expect(await access.validate()).toBe(false);
  expect(access.state.phase).toBe('attention');
  expect(access.mayReadLocal).toBe(false);
  expect(() => access.assertRemote(access.state.epoch, 'read')).toThrow();
  access.dispose();
});

test('only a classified outage permits continued prepared offline editing', async () => {
  for (const [failure, phase] of [
    [new OfflineConnectionError('Disconnected.'), 'local'],
    [new Error('Unauthorized or malformed response.'), 'attention'],
  ] as const) {
    const access = new OfflineAccess(scope, async () => {
      throw failure;
    });
    access.completeRecovery();
    expect(await access.validate()).toBe(false);
    expect(access.state.phase).toBe(phase);
    expect(access.mayEditLocal).toBe(phase === 'local');
    expect(() => access.assertRemote(access.state.epoch, 'read')).toThrow();
    access.dispose();
  }
});

test('viewer scopes remain read-only after successful recovery and access validation', async () => {
  const viewer = { ...scope, access: 'viewer' as const };
  const access = new OfflineAccess(viewer, async () => ({ ...proof(), access: 'viewer' }));
  access.completeRecovery();
  await access.validate();
  expect(access.mayReadLocal).toBe(true);
  expect(access.mayEditLocal).toBe(false);
  expect(() => access.assertRemote(access.state.epoch, 'read')).not.toThrow();
  expect(() => access.assertRemote(access.state.epoch, 'write')).toThrow();
  access.networkLost();
  expect(access.mayEditLocal).toBe(false);
  access.dispose();
});

test('a superseded check cannot replace a newer successful decision', async () => {
  const pending = deferred<AccessProof>();
  let calls = 0;
  const access = new OfflineAccess(scope, () =>
    ++calls === 1 ? pending.promise : Promise.resolve(proof()),
  );
  access.completeRecovery();
  const old = access.validate();
  expect(await access.validate()).toBe(true);
  const epoch = access.state.epoch;
  pending.resolve({ ...proof(), accountId: 'old cookie' });
  expect(await old).toBe(false);
  expect(() => access.assertRemote(epoch, 'read')).not.toThrow();
  access.dispose();
});

test.each(['lock', 'dispose', 'network lost'])(
  'subscriber-driven %s during validation closes the gate before a request starts',
  async (action) => {
    let requests = 0;
    const access = new OfflineAccess(scope, async () => {
      requests++;
      return proof();
    });
    access.completeRecovery();
    const subscription = access.state$.subscribe((state) => {
      if (state.phase !== 'checking') return;
      if (action === 'lock') access.lock('Account changed.');
      else if (action === 'dispose') access.dispose();
      else access.networkLost();
    });
    expect(await access.validate()).toBe(false);
    expect(requests).toBe(0);
    expect(() => access.assertRemote(access.state.epoch, 'read')).toThrow();
    subscription.unsubscribe();
    access.dispose();
  },
);

test('an abort listener can supersede validation without a later request reopening it', async () => {
  const pending = deferred<AccessProof>();
  let requests = 0;
  const access = new OfflineAccess(scope, (_scope, signal) => {
    requests++;
    signal.addEventListener('abort', () => access.networkLost());
    return pending.promise;
  });
  const first = access.validate();
  expect(await access.validate()).toBe(false);
  expect(requests).toBe(1);
  pending.resolve(proof());
  expect(await first).toBe(false);
  expect(access.state.phase).toBe('local');
  access.dispose();
});

test('an online subscriber can lock immediately; validation must report that final denial', async () => {
  const access = new OfflineAccess(scope, async () => proof());
  access.completeRecovery();
  const subscription = access.state$.subscribe((state) => {
    if (state.phase === 'online') access.lock('Signed out during notification.');
  });
  const observed: string[] = [];
  const second = access.state$.subscribe((state) => observed.push(state.phase));
  expect(await access.validate()).toBe(false);
  expect(access.state.phase).toBe('locked');
  expect(() => access.assertRemote(access.state.epoch, 'read')).toThrow();
  expect(observed).toEqual(['local', 'checking', 'locked']);
  subscription.unsubscribe();
  second.unsubscribe();
  access.dispose();
});
