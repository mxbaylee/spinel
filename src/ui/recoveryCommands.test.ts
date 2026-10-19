import { expect, test } from 'vitest';
import { CommandType, Injector } from '@univerjs/core';
import type { IConfigService, IExecutionOptions, ILogService } from '@univerjs/core';
import { RecoveryCommands } from '../../web/offline/RecoveryCommands.ts';
import { RecoveryLedger } from '../../web/offline/RecoveryLedger.ts';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';

const id = 'doc.mutation.rich-text-editing';
function fixture(handler: () => boolean | Promise<boolean> = () => true) {
  const injector = new Injector();
  const scope = {
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'doc' as const,
    access: 'owner' as const,
    sdkVersion: '1.1.0' as const,
    schema: 1 as const,
    revisionOffset: 0,
  };
  const access = new OfflineAccess(scope, async () => ({ ...scope, restoring: false }));
  const ledger = new RecoveryLedger(
    access,
    1,
    {
      unitID: 'unit',
      userId: 'owner',
      type: 1,
      rev: 3,
      awaitingChangeset: null,
      mutations: [{ id, params: { unitId: 'unit', actions: ['pending'] } }],
    },
    () => 'owner',
  );
  const seen: IExecutionOptions[] = [];
  const commands = new RecoveryCommands(
    injector,
    { debug() {}, warn() {}, error() {} } as unknown as ILogService,
    { getConfig: () => false } as unknown as IConfigService,
    () => ledger,
  );
  commands.registerCommand({
    id,
    type: CommandType.MUTATION,
    handler: (_accessor, _params, options) => {
      seen.push(options ?? {});
      return handler();
    },
  });
  return {
    commands,
    ledger,
    access,
    seen,
    params: () => ledger.readForSDK().mutations[0].params,
    dispose: () => {
      commands.dispose();
      injector.dispose();
    },
  };
}

test.each(['sync', 'async'])(
  '%s public dispatch applies one original entry and rejects a second read copy',
  async (mode) => {
    const f = fixture();
    try {
      const first = f.params(),
        second = f.params();
      const before = structuredClone(first),
        options = { fromCollab: false };
      if (mode === 'sync') expect(f.commands.syncExecuteCommand(id, first, options)).toBe(true);
      else expect(await f.commands.executeCommand(id, first, options)).toBe(true);
      expect(f.seen).toEqual([{ fromCollab: false, fromChangeset: true }]);
      expect(options).toEqual({ fromCollab: false });
      expect(first).toEqual(before);
      f.ledger.assertComplete();
      expect(f.access.state.recovered).toBe(false);
      expect(() => f.commands.syncExecuteCommand(id, second)).toThrow(/more than once|too late/);
      expect(f.seen).toHaveLength(1);
    } finally {
      f.dispose();
    }
  },
);

test.each(['sync throw', 'sync false', 'async throw', 'async false'])(
  '%s never earns replay completion',
  async (mode) => {
    const f = fixture(() => {
      if (mode.endsWith('throw')) throw new Error('execution failed');
      return false;
    });
    try {
      const params = f.params();
      if (mode.startsWith('async'))
        await expect(f.commands.executeCommand(id, params)).rejects.toThrow();
      else expect(() => f.commands.syncExecuteCommand(id, params)).toThrow();
      expect(f.access.state.phase).toBe('attention');
      expect(() => f.ledger.assertComplete()).toThrow();
      expect(() => f.commands.syncExecuteCommand(id, { unitId: 'unit' })).toThrow();
      expect(f.seen).toHaveLength(1);
    } finally {
      f.dispose();
    }
  },
);

test('an unresolved execution cannot open the recovery gate, and locking before its result invalidates it', async () => {
  const deferred = Promise.withResolvers<boolean>();
  const f = fixture(() => deferred.promise);
  try {
    const pending = f.commands.executeCommand(id, f.params());
    const rejected = expect(pending).rejects.toThrow();
    expect(f.access.state.recovered).toBe(false);
    f.access.lock('Account switched while a command awaited completion.');
    deferred.resolve(true);
    await rejected;
    expect(f.access.state.phase).toBe('locked');
    expect(() => f.ledger.assertComplete()).toThrow();
  } finally {
    f.dispose();
  }
});

test('sync-only notifications do not consume the later real execution', async () => {
  const f = fixture();
  try {
    const params = f.params();
    f.commands.syncExecuteCommand(id, params, { syncOnly: true });
    expect(f.seen).toEqual([]);
    await f.commands.executeCommand(id, params);
    f.ledger.assertComplete();
    expect(f.seen).toEqual([{ fromChangeset: true }]);
    f.commands.syncExecuteCommand(id, { unitId: 'unit', actions: ['new user edit'] });
    expect(f.seen[1]).toEqual({});
  } finally {
    f.dispose();
  }
});
