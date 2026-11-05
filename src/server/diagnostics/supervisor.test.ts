import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { diagnosticsConfiguration } from './configuration.ts';
import { DiagnosticsStore } from './store.ts';
import { supervisorDiagnostics } from './supervisor.ts';

test('supervisor observations retain truncate fencing, preserve active export files and expose process-local losses', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-supervisor-diagnostics-'));
  const applicationPath = join(directory, 'app.sqlite');
  const application = new DatabaseSync(applicationPath);
  application.exec("CREATE TABLE content(value TEXT); INSERT INTO content VALUES ('kept')");
  const config = diagnosticsConfiguration(applicationPath);
  const owner = new DiagnosticsStore(config);
  const exportDirectory = join(directory, '.diagnostics-export-AbCdEf');
  mkdirSync(exportDirectory);
  const exportPath = join(exportDirectory, 'diagnostics.sqlite');
  writeFileSync(exportPath, 'active export');
  const supervisor = supervisorDiagnostics(applicationPath);
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  let reader: DatabaseSync | undefined;
  try {
    expect(existsSync(exportPath)).toBe(true);
    supervisor.sink(
      { name: 'maintenance.phase', details: { phase: 'running' } },
      { component: 'server' },
    );
    const { generation } = owner.truncate();
    supervisor.sink(
      { name: 'maintenance.phase', details: { phase: 'paused' } },
      { component: 'server' },
    );
    const originalClose = DiagnosticsStore.prototype.close;
    const close = vi
      .spyOn(DiagnosticsStore.prototype, 'close')
      .mockImplementationOnce(async function (this: DiagnosticsStore) {
        await originalClose.call(this);
        throw new Error('observation handle teardown failed');
      });
    try {
      await expect(supervisor.close()).resolves.toBeUndefined();
    } finally {
      close.mockRestore();
    }
    reader = new DatabaseSync(config.path);
    const rows = reader
      .prepare('SELECT name,generation,source,actor_id,run_id,details FROM events ORDER BY rowid')
      .all();
    expect(rows.map((row) => row.name)).toEqual(['maintenance.phase', 'diagnostics.writer-loss']);
    expect(
      rows.every(
        (row) => row.generation === generation && row.source === 'backend' && row.actor_id === null,
      ),
    ).toBe(true);
    expect(new Set(rows.map((row) => row.run_id)).size).toBe(1);
    expect(JSON.parse(String(rows[0].details))).toEqual({ phase: 'paused' });
    expect(JSON.parse(String(rows[1].details))).toEqual({
      writer: 'supervisor',
      invalid: 0,
      queue: 0,
      storage: 0,
      unavailable: 0,
      stale: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      'Supervisor diagnostics process-lifetime drops:',
      JSON.stringify({ invalid: 0, queue: 0, storage: 0, unavailable: 0, stale: 1 }),
    );
    expect(warn).toHaveBeenCalledWith(
      'Supervisor diagnostics could not close its observation store.',
    );
    expect(application.prepare('SELECT * FROM content').all()).toEqual([{ value: 'kept' }]);
    expect(existsSync(exportPath)).toBe(true);
  } finally {
    warn.mockRestore();
    reader?.close();
    await supervisor.close();
    await owner.close();
    application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
