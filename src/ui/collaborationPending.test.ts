import { afterEach, expect, test, vi } from 'vitest';
import type { Univer } from '@univerjs/core';
import { prepareCollaboration, watchCollaboration } from '../../web/collaboration.ts';
import { getSpinelSync } from '../../web/spinelSync.ts';

vi.mock('../../web/spinelSync.ts', () => ({
  getSpinelSync: vi.fn(),
  loadSpinelDocument: vi.fn(),
  disposeSpinelSync: vi.fn(),
}));

// Native pending-state, acknowledgment, reconnect and access-change regressions
// live in spinelSync.test.ts and the real-client capture/undo tests. There is no
// separate SDK recovery-cache flush or legacy status stream after cutover.
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

test.each([401, 403, 404])(
  'late preparation denial %i cannot revoke a replacement guest editor',
  async (status) => {
    const root = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal('location', { pathname: `/share/${root}` });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    let current = true;
    const opening = prepareCollaboration('old-child', root, () => current);
    current = false;
    release(Response.json({ error: 'Unavailable' }, { status }));
    await expect(opening).rejects.toThrow('Unavailable');
    expect(dispatchEvent).not.toHaveBeenCalled();
    const active = prepareCollaboration('current-child', root, () => true);
    release(Response.json({ error: 'Unavailable' }, { status }));
    await expect(active).rejects.toThrow('Unavailable');
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0].type).toBe('spinel-guest-revoked');
  },
);

test.each([undefined, 0, 2])(
  'an obsolete preparation response (%s) cannot choose another backend',
  async (syncVersion) => {
    vi.stubGlobal('location', { pathname: '/' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          unitId: 'unit',
          access: 'editor',
          user: { id: 'person', name: 'Person' },
          syncVersion,
        }),
      ),
    );
    await expect(prepareCollaboration('item')).rejects.toThrow('Reload this page');
  },
);

test('preparation uses the current native protocol for each document', async () => {
  vi.stubGlobal('location', { pathname: '/' });
  const response = {
    unitId: 'unit',
    access: 'editor',
    user: { id: 'person', name: 'Person' },
    syncVersion: 1,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(response)),
  );
  await expect(prepareCollaboration('item')).resolves.toEqual(response);
  await expect(prepareCollaboration('next')).resolves.toEqual(response);
});

test('save state and retry bind only to the document native client', () => {
  const univer = {} as Univer;
  const publish = vi.fn(),
    readonly = vi.fn(),
    connection = vi.fn();
  const handle = { retry: vi.fn(), dispose: vi.fn() };
  const watch = vi.fn(() => handle);
  vi.mocked(getSpinelSync).mockReturnValue({ watch } as unknown as NonNullable<
    ReturnType<typeof getSpinelSync>
  >);
  expect(watchCollaboration(univer, publish, readonly, connection)).toBe(handle);
  expect(getSpinelSync).toHaveBeenCalledWith(univer);
  expect(watch).toHaveBeenCalledWith({ publish, readonly, connection });
  vi.mocked(getSpinelSync).mockReturnValue(undefined);
  expect(() => watchCollaboration(univer, publish, readonly, connection)).toThrow(
    'Reload to try again',
  );
});
