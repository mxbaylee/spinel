import { devices, expect, test } from '@playwright/test';
import type { WebSocket } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test.describe.configure({ retries: 0 });
test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 1100 },
  serviceWorkers: 'block',
});
for (const kind of ['sheet', 'doc'] as const) {
  test(`prepared ${kind} transport uses public hooks and rejects stale connection attempts`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const db = openDatabase('test-results/mobile-https/app.sqlite');
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Prepared transport owner');
    const item = workspace.create(owner.id, {
      name: 'Prepared transport fixture',
      kind,
      parentId: null,
    });
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(owner.id).token,
        url: baseURL!,
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    let sockets = 0;
    let protocolRequests = 0;
    let submissions = 0;
    let frames = 0;
    const liveSockets = new Set<WebSocket>();
    const established = new Set<WebSocket>();
    const unbound: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/universer-api/')) {
        protocolRequests++;
        if (url.pathname.endsWith('/new_changes')) submissions++;
        if (request.headers()['x-spinel-account'] !== owner.id) unbound.push(url.pathname);
      }
    });
    page.on('websocket', (socket) => {
      sockets++;
      liveSockets.add(socket);
      socket.on('close', () => {
        liveSockets.delete(socket);
        established.delete(socket);
      });
      socket.on('framereceived', () => {
        if (liveSockets.has(socket)) established.add(socket);
      });
      socket.on('framesent', () => frames++);
      const url = new URL(socket.url());
      expect(url.searchParams.get('unitID')).toBe(item.id);
      expect(url.searchParams.get('spinelAccount')).toBe(owner.id);
    });
    try {
      await page.goto(`/?item=${item.id}&transport-probe=1`);
      const region = page.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      await expect(
        region.getByRole('status', { name: 'Save status' }),
        errors.join('\n'),
      ).toHaveText('All changes saved.', { timeout: 30_000 });
      expect(protocolRequests).toBeGreaterThan(0);
      expect(sockets).toBeGreaterThan(0);
      expect(unbound).toEqual([]);
      if (kind === 'sheet') {
        const address = region.getByRole('textbox').nth(2);
        await address.fill('A1');
        await address.press('Enter');
        await page.keyboard.type('Prepared edit');
        await page.keyboard.press('Enter');
      } else {
        await region.locator('.univer-container').click({ position: { x: 130, y: 200 } });
        await page.keyboard.press('Control+Home');
        await page.keyboard.type('Prepared edit');
      }
      await expect
        .poll(async () => {
          const response = await context.request.get(`/api/items/${item.id}/${kind}`);
          const { snapshot } = await response.json();
          return kind === 'sheet'
            ? snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[0]?.v
            : snapshot.body?.dataStream.trim();
        })
        .toBe('Prepared edit');
      await expect(region.getByRole('status', { name: 'Save status' })).toHaveText(
        'All changes saved.',
      );
      expect(submissions).toBeGreaterThan(0);
      const ticketReceived = Promise.withResolvers<void>();
      const releaseTicket = Promise.withResolvers<void>();
      let held = false;
      await context.route('**/universer-api/user/session-ticket*', async (route) => {
        if (!held) {
          held = true;
          ticketReceived.resolve();
          await releaseTicket.promise;
        }
        try {
          await route.continue();
        } catch {
          /* access cancellation aborts the XHR */
        }
      });
      const before = sockets;
      const pending = page.evaluate(() => window.__spinelTransportProbe!.connect());
      await ticketReceived.promise;
      expect(await page.evaluate(() => window.__spinelTransportProbe!.connect())).toBe(false);
      await page.evaluate(() => window.__spinelTransportProbe!.outage());
      releaseTicket.resolve();
      expect(await pending).toBe(false);
      expect(sockets).toBe(before);
      expect(await page.evaluate(() => window.__spinelTransportProbe!.validate())).toBe(true);
      await expect
        .poll(() => page.evaluate(() => window.__spinelTransportProbe!.connect()))
        .toBe(true);
      expect(sockets).toBeGreaterThan(before);
      await expect.poll(() => liveSockets.size).toBeGreaterThan(0);
      await expect.poll(() => established.size).toBeGreaterThan(0);
      await page.evaluate(() => window.__spinelTransportProbe!.lock());
      const locked = { sockets, protocolRequests, frames };
      await expect.poll(() => liveSockets.size).toBe(0);
      expect(await page.evaluate(() => window.__spinelTransportProbe!.connect())).toBe(false);
      // Covers the SDK's one-second automatic reconnect timer while locked.
      await new Promise((resolve) => setTimeout(resolve, 2200));
      expect({ sockets, protocolRequests, frames }).toEqual(locked);
      expect(unbound).toEqual([]);
    } finally {
      await page.close();
      db.close();
    }
  });
}
