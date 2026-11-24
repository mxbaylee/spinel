import { expect, test, type BrowserContext } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { cleanupSessionRevocation, observeSessionRevocation } from './session-revocation.ts';
import { startSocketRelay, type SocketRelay } from './socket-relay.ts';

test('operator removes a passkey from an open editor, then disables the account without deleting its document', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const runId = `${info.testId}-${info.retry}`;
  const operator = auth.createUser('Device operator ' + runId, true),
    user = auth.createUser('Device owner ' + runId),
    collaborator = auth.createUser('Retained collaborator ' + runId);
  const item = workspace.create(user.id, {
    name: 'Preserved budget',
    kind: 'sheet',
    parentId: null,
  });
  workspace.share(user.id, item.id, collaborator.id, 'editor');
  for (const key of ['Lost browser', 'Backup passkey'])
    db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      `${runId}-${key}`,
      user.id,
      Buffer.from([1]),
      0,
      '[]',
      key,
      'Browser',
      auth.now(),
      null,
      0,
      'singleDevice',
    );
  const adminSession = auth.createSession(operator.id),
    device = auth.createSession(user.id, undefined, `${runId}-Lost browser`),
    kept = auth.createSession(user.id, undefined, `${runId}-Backup passkey`),
    collaboratorSession = auth.createSession(collaborator.id);
  type Observation = Awaited<ReturnType<typeof observeSessionRevocation>>;
  let editorContext: BrowserContext | undefined;
  let relay: SocketRelay | undefined;
  let observation: Observation | undefined;
  type RevocationPhase = 'passkey' | 'account';
  let phase: RevocationPhase = 'passkey';
  const observations: Partial<
    Record<
      RevocationPhase,
      {
        observation: ReturnType<Observation['snapshot']>;
        relay: ReturnType<SocketRelay['snapshot']>;
      }
    >
  > = {};
  const capture = () => {
    if (observation && relay)
      observations[phase] = { observation: observation.snapshot(), relay: relay.snapshot() };
  };
  let phaseOneCleanup: string[] | null = null;
  let cleanupFailures: string[] = [],
    attachmentFailures: string[] = [];
  let contractCompleted = false,
    primaryFailed = false;
  const failures: unknown[] = [];
  try {
    const socketURL = new URL(`/sync-api/items/${item.id}/socket`, baseURL);
    // Navigation can hide the browser close event. Reuse the existing passive
    // relay to witness this editor's physical socket closure before cleanup.
    relay = await startSocketRelay(baseURL!, socketURL.pathname);
    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      proxy: { server: relay.proxyServer },
    });
    editorContext = ownerContext;
    const editor = await ownerContext.newPage();
    socketURL.protocol = socketURL.protocol === 'https:' ? 'wss:' : 'ws:';
    observation = await observeSessionRevocation(editor, socketURL.href, relay);
    const cookie = (token: string) => ({
      name: COOKIE_NAME,
      value: token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict' as const,
    });
    await context.addCookies([cookie(adminSession.token)]);
    await ownerContext.addCookies([cookie(device.token)]);
    const saved = editor.getByRole('status', { name: 'Save status' });
    const expectConnected = async () => {
      await expect(saved).toHaveText('All changes saved.', { timeout: 30_000 });
      // Saved data does not prove that this login has established its socket.
      await expect(
        editor.getByRole('status', { name: 'Connection status', exact: true }),
      ).toHaveText('Online');
      await expect.poll(() => observation!.snapshot().openSockets).toBeGreaterThan(0);
    };
    const expectRevoked = async () => {
      await expect.poll(() => observation!.isClosed(), { timeout: 5000 }).toBe(true);
      observation!.checkpoint('closure-observed');
      // Native sync fences the editor; another authenticated request may already
      // have redirected to sign-in. Both are valid, unlike a generic page error.
      await expect(
        saved
          .filter({ hasText: /^Access changed\./ })
          .or(editor.getByRole('button', { name: 'Sign in with a passkey', exact: true })),
      ).toBeVisible({ timeout: 10_000 });
      observation!.assertRevoked(
        (await ownerContext.request.get(`${baseURL}/api/items/${item.id}/sheet`)).status(),
      );
      observation!.checkpoint('request-denied');
    };
    await editor.goto(`${baseURL}/?item=${item.id}`);
    await expectConnected();
    const box = editor
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await box.fill('A1');
    await box.press('Enter');
    await editor.keyboard.type('Keep this');
    await editor.keyboard.press('Enter');
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await ownerContext.request.get(`${baseURL}/api/items/${item.id}/sheet`)).json())
            .snapshot,
        ),
      )
      .toContain('Keep this');
    await expect(saved).toHaveText('All changes saved.');
    await page.goto('/admin');
    const account = page.getByRole('region', { name: `${user.name} account`, exact: true });
    await expect(account.getByText('Member · Active', { exact: true })).toBeVisible();
    await account.getByRole('button', { name: `Actions for ${user.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Manage passkeys' }).click();
    const passkeys = page.getByRole('dialog', { name: `Passkeys for ${user.name}`, exact: true });
    await expect(passkeys.getByText(/Last used Never/)).toHaveCount(2);
    await passkeys
      .getByRole('button', { name: 'Actions for passkey Lost browser', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove passkey…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove Lost browser?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(auth.session(device.token)).toBeDefined();
    await passkeys
      .getByRole('button', { name: 'Actions for passkey Lost browser', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Remove passkey…' }).click();
    observation.beforeRevoke();
    await dialog.getByRole('button', { name: 'Remove passkey' }).click();
    await expect(passkeys.getByText('Lost browser', { exact: true })).toHaveCount(0);
    observation.checkpoint('revocation-written');
    await expectRevoked();
    expect(auth.session(device.token)).toBeUndefined();
    expect(auth.session(kept.token)?.user_id).toBe(user.id);
    capture();
    phaseOneCleanup = await cleanupSessionRevocation([
      { name: 'observer', run: () => observation!.stop() },
    ]);
    if (phaseOneCleanup.length) throw new Error('Passkey observer cleanup failed.');
    observation = undefined;
    // Observe the retained login before navigating, so the new socket's
    // creation and successful handshake belong to this second phase.
    await editor.goto('about:blank');
    await ownerContext.clearCookies();
    await ownerContext.addCookies([cookie(kept.token)]);
    phase = 'account';
    observation = await observeSessionRevocation(editor, socketURL.href, relay);
    await editor.goto(`${baseURL}/?item=${item.id}`);
    await expectConnected();
    const keptCopy = await ownerContext.request.get(`${baseURL}/api/items/${item.id}/sheet`);
    expect(keptCopy.status()).toBe(200);
    expect(JSON.stringify((await keptCopy.json()).snapshot)).toContain('Keep this');
    await passkeys.getByRole('button', { name: 'Done', exact: true }).click();
    await account.getByRole('button', { name: `Actions for ${user.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Disable account…' }).click();
    observation.beforeRevoke();
    await page
      .getByRole('dialog', { name: `Disable ${user.name}?`, exact: true })
      .getByRole('button', { name: 'Disable account' })
      .click();
    await expect(account.getByText('Member · Disabled', { exact: true })).toBeVisible();
    observation.checkpoint('revocation-written');
    await expectRevoked();
    expect(auth.session(kept.token)).toBeUndefined();
    expect(workspace.get(collaborator.id, item.id, 'edit').access).toBe('editor');
    const sharedCopy = await context.request.get(`/api/items/${item.id}/sheet`, {
      headers: { Cookie: `${COOKIE_NAME}=${collaboratorSession.token}` },
    });
    expect(sharedCopy.status()).toBe(200);
    expect(JSON.stringify((await sharedCopy.json()).snapshot)).toContain('Keep this');
    expect(
      db.prepare('SELECT owner_id FROM workspace_items WHERE id=?').get(item.id)?.owner_id,
    ).toBe(user.id);
    expect((await context.request.get(`/api/items/${item.id}/sheet`)).status()).toBe(403);
    expect((await context.request.get('/api/auth/invites')).status()).toBe(200);
    expect(observation.isClosed()).toBe(true);
    expect(relay.snapshot().failed).toBe(0);
    // Vite's HMR socket is a foreign authority in development only.
    if (info.project.name !== 'development') expect(relay.snapshot().unexpected).toBe(0);
    contractCompleted = true;
  } catch (error) {
    primaryFailed = true;
    failures.push(error);
  } finally {
    // Capture both phases before owned cleanup can close any remaining socket.
    capture();
    const relayBeforeCleanup = relay?.snapshot() ?? null;
    cleanupFailures = await cleanupSessionRevocation([
      { name: 'observer', run: () => observation?.stop() },
      { name: 'context', run: () => editorContext?.close() },
      { name: 'relay', run: () => relay?.stop() },
      { name: 'database', run: () => db.close() },
    ]);
    attachmentFailures = await cleanupSessionRevocation([
      {
        name: 'diagnostics',
        run: () =>
          info.attach('admin-session-revocation-observation', {
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify(
                {
                  version: 1,
                  project: info.project.name,
                  retry: info.retry,
                  tested: process.env.GITHUB_SHA ?? null,
                  node: process.version,
                  browser: browser.version(),
                  contractCompleted,
                  primaryFailed,
                  activePhase: phase,
                  phaseOneCleanup,
                  cleanupFailures,
                  observations,
                  relay: relayBeforeCleanup,
                },
                null,
                2,
              ),
            ),
          }),
      },
    ]);
  }
  if (cleanupFailures.length || attachmentFailures.length)
    failures.push(
      new Error(
        `Revocation fixture cleanup failed: ${[...cleanupFailures, ...attachmentFailures].join(', ')}.`,
      ),
    );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Revocation or resource cleanup failed.', {
      cause: failures[0],
    });
});
