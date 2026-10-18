import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createApp } from '../server/app.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';

test('operator sees missing configuration, backup failure and the last good backup after reopening Admin', async ({
  page,
  context,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-backup-e2e-'));
  const databasePath = join(directory, 'spinel.sqlite');
  const port = testInfo.project.name === 'development' ? 3194 : 3195;
  const origin = `http://localhost:${port}`;
  const app = await createApp({
    databasePath,
    origin,
    development: testInfo.project.name === 'development',
  });
  await new Promise<void>((ready) => app.server.listen(port, '127.0.0.1', ready));
  const db = openDatabase(databasePath),
    auth = new AuthStore(db);
  const admin = auth.createUser('Operator', true),
    session = auth.createSession(admin.id);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: session.token,
      url: origin.replace('http:', 'https:'),
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  try {
    await page.goto(`${origin}/admin`);
    const panel = page.getByRole('region', { name: 'Backups' });
    await expect(
      panel.getByText('Offsite backups are not configured.', { exact: false }),
    ).toBeVisible();
    await expect(panel.getByText('Last successful backup: None yet')).toBeVisible();
    db.prepare('UPDATE backup_state SET last_good=?, last_attempt=?, error=?').run(
      Date.now() - 86400_000,
      Date.now(),
      'Backup or retention failed. Check storage access.',
    );
    await page.reload();
    await expect(
      panel.getByRole('alert').filter({ hasText: 'Backup or retention failed' }),
    ).toBeVisible();
    await expect(panel.getByText('Last successful backup:', { exact: false })).not.toContainText(
      'None yet',
    );
    await expect(page.getByRole('heading', { name: 'Invites', exact: true })).toBeVisible();
    db.exec('UPDATE backup_state SET error=NULL');
    await page.reload();
    await expect(panel.getByText('Backup or retention failed', { exact: false })).toHaveCount(0);
  } finally {
    db.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
