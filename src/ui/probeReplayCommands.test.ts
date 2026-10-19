import { expect, test } from 'vitest';
import { CommandType, Injector } from '@univerjs/core';
import type { IConfigService, IExecutionOptions, ILogService } from '@univerjs/core';
import { markRecoveredParams, ProbeReplayCommands } from '../../web/ProbeReplayCommands.ts';

test('replay execution metadata follows exact cached objects once, never equal new edits or retry payloads', async () => {
  const injector = new Injector();
  let user = 'owner';
  const service = new ProbeReplayCommands(
    injector,
    { debug() {}, warn() {}, error() {} } as unknown as ILogService,
    { getConfig: () => false } as unknown as IConfigService,
    'unit',
    () => user,
  );
  const id = 'doc.mutation.rich-text-editing';
  const seen: (IExecutionOptions | undefined)[] = [];
  service.registerCommand({
    id,
    type: CommandType.MUTATION,
    handler: (_accessor, _params, options) => {
      seen.push(options);
      return true;
    },
  });
  const original = { unitId: 'unit', actions: ['same genuine input'] };
  const before = structuredClone(original);
  try {
    markRecoveredParams(id, original, 'unit', user);
    service.syncExecuteCommand(id, structuredClone(original));
    expect(seen).toEqual([{}]);
    service.syncExecuteCommand(id, original, { syncOnly: true });
    expect(seen).toHaveLength(1);
    await service.executeCommand(id, original);
    expect(seen[1]).toMatchObject({ fromChangeset: true, spinelRecoveredIdentity: true });
    expect(original).toEqual(before);
    service.syncExecuteCommand(id, original);
    expect(seen[2]).toEqual({});
    const pending = structuredClone(original);
    markRecoveredParams(id, pending, 'unit', user);
    service.syncExecuteCommand(id, pending);
    expect(seen[3]).toMatchObject({ fromChangeset: true });
    expect(pending).toEqual(before);
    const stale = structuredClone(original);
    markRecoveredParams(id, stale, 'unit', user);
    user = 'different-account';
    expect(() => service.syncExecuteCommand(id, stale)).toThrow(/outside/);
    expect(seen).toHaveLength(4);
  } finally {
    service.dispose();
    injector.dispose();
  }
});

test.each(['sync throw', 'sync false', 'async throw', 'async false'])(
  '%s invalidates the recovery experiment instead of retrying an unmarked edit',
  async (mode) => {
    const injector = new Injector();
    const service = new ProbeReplayCommands(
      injector,
      { debug() {}, warn() {}, error() {} } as unknown as ILogService,
      { getConfig: () => false } as unknown as IConfigService,
      'unit',
      () => 'owner',
    );
    const id = 'doc.mutation.rich-text-editing';
    service.registerCommand({
      id,
      type: CommandType.MUTATION,
      handler: () => {
        if (mode.endsWith('throw')) throw new Error('Synthetic mutation failure.');
        return false;
      },
    });
    const params = { unitId: 'unit' };
    markRecoveredParams(id, params, 'unit', 'owner');
    try {
      if (mode.startsWith('async'))
        await expect(service.executeCommand(id, params)).rejects.toThrow();
      else expect(() => service.syncExecuteCommand(id, params)).toThrow();
      expect(() => service.syncExecuteCommand(id, params)).toThrow(/probe is invalid/);
      await expect(service.executeCommand(id, { unitId: 'unit' })).rejects.toThrow(
        /probe is invalid/,
      );
    } finally {
      service.dispose();
      injector.dispose();
    }
  },
);
