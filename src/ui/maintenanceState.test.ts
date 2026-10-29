import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paused = {
  available: true,
  phase: 'paused',
  epoch: 'maintenance-epoch-before-reconnect',
  notice: null,
};

describe('public maintenance state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', new EventTarget());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the last pause and its epoch if the independent endpoint disappears', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(paused));
    vi.stubGlobal('fetch', fetch);
    const state = await import('../../web/maintenanceState.ts');
    await state.refreshMaintenanceStatus();
    expect(state.getMaintenanceEpoch()).toBe(paused.epoch);
    for (const response of [
      new Response(null, { status: 404 }),
      Response.json({ error: 'Service unavailable' }, { status: 503 }),
      Response.json({ available: false, phase: 'running', epoch: '', notice: null }),
    ]) {
      fetch.mockResolvedValueOnce(response);
      await state.refreshMaintenanceStatus();
      expect(state.getMaintenanceStatus()).toEqual(paused);
    }
  });

  it('accepts valid proxy status while the application is stopped and excludes private fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            ...paused,
            phase: 'stopped',
            operationId: 'private-operation',
            resumeToken: 'never-a-public-field',
          },
          { status: 503 },
        ),
      ),
    );
    const state = await import('../../web/maintenanceState.ts');
    await state.refreshMaintenanceStatus();
    expect(state.getMaintenanceStatus()).toEqual({ ...paused, phase: 'stopped' });
  });

  it('retries after a synchronous network failure rather than retaining a settled request', async () => {
    const fetch = vi.fn().mockImplementationOnce(() => {
      throw new TypeError('Network unavailable');
    });
    vi.stubGlobal('fetch', fetch);
    const state = await import('../../web/maintenanceState.ts');
    await state.refreshMaintenanceStatus();
    fetch.mockResolvedValueOnce(Response.json(paused));
    await state.refreshMaintenanceStatus();
    expect(state.getMaintenanceStatus()).toEqual(paused);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
