import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { InvitationService } from '../src/server/auth/invitations.ts';

// Actual current routes are the redesign's baseline; proposed routes stay in Storybook.
test('capture account and unavailable guest screens for the design review', async ({
  page,
  context,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const operator = auth.createUser('Design review Operator', true);
  const owner = auth.createUser('Design review Owner');
  const invites = new InvitationService(auth, baseURL!);
  const invitation = invites.create(operator.id);
  const recovery = invites.create(operator.id, 24, owner.id);
  await mkdir('test-results/theme-screenshots', { recursive: true });
  try {
    for (const [name, url, heading] of [
      ['sign-in', '/sign-in', 'Your workspace.'],
      ['invite', invitation.url, 'You’re invited.'],
      ['recovery', recovery.url, 'Recover your account'],
      ['revoked', '/share/00000000-0000-4000-8000-000000000000#invalid', ''],
    ]) {
      await page.goto(url);
      if (heading)
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      else
        await expect(page.getByText('This link no longer works.', { exact: true })).toBeVisible();
      for (const [theme, width, label] of [
        ['light', 1280, 'light'],
        ['dark', 1280, 'dark'],
        ['light', 390, 'phone-light'],
      ['dark', 390, 'phone-dark'],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.screenshot({
          path: `test-results/theme-screenshots/${name === 'revoked' ? 'before' : 'spn-083'}-${name}-${label}-${info.project.name}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(owner.id).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Your profile', exact: true })).toBeVisible();
    for (const [theme, width, label] of [
      ['light', 1280, 'light'],
      ['dark', 1280, 'dark'],
      ['light', 390, 'phone'],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({
        path: `test-results/theme-screenshots/before-settings-${label}-${info.project.name}.png`,
        fullPage: true,
      });
    }
  } finally {
    db.prepare('DELETE FROM auth_users WHERE id IN (?,?)').run(owner.id, operator.id);
    db.close();
  }
});
