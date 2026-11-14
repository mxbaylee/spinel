import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import { formulaBody, parseFormula } from '@spinel/doc-formulas';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { WorkspaceFiles } from '../src/server/workspace/files.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';

test.use({ hasTouch: true });

function fixture(info: TestInfo, externalSpace = false) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const owner = auth.createUser('Source sharing owner ' + info.testId);
  // Sharing lists every everyday account in the shared test database. Give each
  // scenario/retry a distinct recipient so role controls cannot match old fixtures.
  const recipient = auth.createUser(
    `Avery · sources ${createHash('sha256').update(info.testId).digest('hex').slice(0, 10)}-${info.retry}`,
  );
  const other = auth.createUser('Other source owner ' + info.testId);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const files = new WorkspaceFiles(workspace);
  const spaces = new SpaceStore(workspace);
  const host = files.create(owner.id, { kind: 'doc', name: 'Autumn report', parentId: null });
  const space = externalSpace
    ? files.create(owner.id, { kind: 'space', name: 'Research archive', parentId: null })
    : null;
  const source = space
    ? spaces.createChild(owner.id, space.id, {
        kind: 'sheet',
        name: 'Survey results',
        parentId: space.id,
      }).item
    : workspace.create(owner.id, { kind: 'sheet', name: 'Household budget', parentId: null });
  const second = workspace.create(externalSpace ? other.id : owner.id, {
    kind: 'sheet',
    name: 'Forecast',
    parentId: null,
  });
  if (externalSpace) workspace.share(other.id, second.id, owner.id, 'viewer');
  else {
    // A deliberate source grant must preserve the recipient's existing stronger role.
    workspace.share(owner.id, second.id, recipient.id, 'editor');
    for (const [item, value] of [
      [source, 12],
      [second, 30],
    ] as const) {
      new SheetStore(workspace).save(owner.id, item.id, {
        snapshot: {
          id: item.id,
          name: item.name,
          appVersion: '1.1.0',
          locale: LocaleType.EN_US,
          styles: {},
          sheetOrder: ['summary'],
          sheets: {
            summary: {
              id: 'summary',
              name: 'Summary',
              rowCount: 100,
              columnCount: 10,
              cellData: { 0: { 0: { v: value } } },
            },
          },
        },
        revision: 0,
        writeId: crypto.randomUUID(),
      });
    }
  }
  const expression = '=SUM(Budget.Summary.A1,Forecast.Summary.A1)';
  const definition: FormulaDefinition = {
    version: 1,
    expression,
    references: parseFormula(expression).map((ref, index) => ({
      start: ref.start,
      end: ref.end,
      range: ref.range,
      itemId: index === 0 ? source.id : second.id,
      sheetId: 'summary',
    })),
  };
  const snapshot = getDocsEmptySnapshot(host.id);
  const body = formulaBody('source-sharing', definition);
  snapshot.body = {
    ...snapshot.body,
    ...body,
    dataStream: body.dataStream + '\r\n',
    paragraphs: [{ startIndex: body.dataStream.length, paragraphId: 'source-sharing-paragraph' }],
    sectionBreaks: [
      { startIndex: body.dataStream.length + 1, sectionId: 'source-sharing-section' },
    ],
  };
  new DocumentStore(workspace).save(owner.id, host.id, {
    snapshot,
    revision: 0,
    writeId: crypto.randomUUID(),
  });
  const grant = (id: string) =>
    db
      .prepare('SELECT role,shared_at FROM workspace_grants WHERE item_id=? AND user_id=?')
      .get(id, recipient.id);
  return {
    db,
    auth,
    owner,
    recipient,
    other,
    workspace,
    files,
    spaces,
    host,
    source,
    second,
    space,
    definition,
    grant,
    close() {
      try {
        // Space parent/membership references are restricted: delete this fixture's
        // only child before its root, keeping foreign-key enforcement enabled.
        if (space) db.prepare('DELETE FROM workspace_items WHERE id=?').run(source.id);
        db.prepare('DELETE FROM workspace_items WHERE owner_id IN (?,?)').run(owner.id, other.id);
        db.prepare('DELETE FROM auth_users WHERE id IN (?,?,?)').run(
          owner.id,
          recipient.id,
          other.id,
        );
      } finally {
        db.close();
      }
    },
  };
}

async function signIn(context: BrowserContext, baseURL: string, auth: AuthStore, user: string) {
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(user).token,
      url: baseURL.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

async function sharing(page: Page, f: ReturnType<typeof fixture>, shared = false) {
  await page.goto(shared ? '/?shared=1' : '/');
  await page.getByRole('button', { name: `More actions for ${f.host.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Share…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Share ${f.host.name}`, exact: true });
  const row = dialog.locator('.sharing-person').filter({
    has: page.getByRole('button', { name: `Edit access for ${f.recipient.name}`, exact: true }),
  });
  const trigger = row.getByRole('button', {
    name: `Edit access for ${f.recipient.name}`,
    exact: true,
  });
  await trigger.click();
  const choice = row.getByRole('combobox');
  const checkbox = row.getByRole('checkbox', {
    name: 'Include formula sources',
    exact: true,
  });
  const apply = row.getByRole('button', {
    name: /^(Share|Save changes)$/,
    exact: true,
  });
  return { dialog, row, trigger, choice, checkbox, apply };
}

async function capture(page: Page, row: Locator, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  const original = page.viewportSize()!;
  for (const [theme, width] of [
    ['light', 1280],
    ['dark', 1280],
    ['light', 390],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await row.locator('.sharing-sources').scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const checkbox = row.getByRole('checkbox');
    if (await checkbox.count()) {
      const label = checkbox.locator('..');
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-076-${state}-${theme}-${width}-${info.project.name}.png`,
      animations: 'disabled',
    });
  }
  await page.setViewportSize(original);
  await page.emulateMedia({ colorScheme: 'light' });
}

test('Doc sharing defaults to host-only, then explicitly adds view sources without changing stronger access', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = fixture(info);
  const reader = await browser.newContext({ baseURL });
  await signIn(context, baseURL!, f.auth, f.owner.id);
  await signIn(reader, baseURL!, f.auth, f.recipient.id);
  const existing = f.grant(f.second.id);
  try {
    const view = await sharing(page, f);
    await view.choice.selectOption('viewer');
    await expect(view.checkbox).toBeEnabled();
    await expect(view.checkbox).not.toBeChecked();
    await view.row.getByText('Source details', { exact: true }).click();
    await expect(view.row.getByText(f.source.name, { exact: true })).toBeVisible();
    await expect(
      view.row
        .getByRole('list', { name: 'Reviewed source access' })
        .getByText('Can edit', { exact: true }),
    ).toBeVisible();
    await capture(page, view.row, info, 'unchecked');
    await view.checkbox.check();
    await view.row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(view.trigger).toBeFocused();
    await view.trigger.click();
    await expect(view.choice).toHaveValue('');
    await view.choice.selectOption('viewer');
    await expect(view.checkbox).not.toBeChecked();
    await view.checkbox.check();
    await view.dialog.getByRole('tab', { name: 'Link', exact: true }).click();
    await view.dialog.getByRole('tab', { name: 'People', exact: true }).click();
    await view.trigger.click();
    await expect(view.choice).toHaveValue('');
    await view.choice.selectOption('viewer');
    await expect(view.checkbox).not.toBeChecked();
    await view.apply.click();
    await expect(view.trigger).toContainText('View only');
    await expect(view.choice).toHaveCount(0);
    expect(f.grant(f.source.id)).toBeUndefined();
    expect(f.grant(f.second.id)).toEqual(existing);
    const evaluate = () =>
      reader.request.post(`/api/items/${f.host.id}/formulas/evaluate`, {
        headers: { Origin: baseURL! },
        data: { definition: f.definition },
      });
    expect(await (await evaluate()).json()).toEqual({ ok: false, reason: 'private-source' });
    await view.trigger.click();
    await expect(view.checkbox).not.toBeChecked();
    await view.checkbox.check();
    await expect(view.apply).toBeEnabled();
    await expect(view.row.getByText('Can view · Proposed', { exact: true })).toBeVisible();
    await capture(page, view.row, info, 'confirmed-targets');
    await view.apply.click();
    await expect(
      view.dialog.getByRole('status').filter({ hasText: 'Formula sources shared' }),
    ).toBeVisible();
    expect(f.grant(f.source.id)?.role).toBe('viewer');
    expect(f.grant(f.second.id)).toEqual(existing);
    expect(await (await evaluate()).json()).toMatchObject({ ok: true, kind: 'scalar', value: 42 });
    expect(f.workspace.links.state(f.source.id)).toBeUndefined();
    await view.dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const reopened = await sharing(page, f);
    await reopened.row.getByText('Already accessible (2)', { exact: true }).click();
    await expect(
      reopened.row
        .getByRole('list', { name: 'Reviewed source access' })
        .getByText('View only', { exact: true }),
    ).toBeVisible();
    await expect(reopened.checkbox).toHaveCount(0);
  } finally {
    await reader.close();
    await page.goto('/sign-in').catch(() => {});
    f.close();
  }
});

test('source sharing discloses an entire external Space, refreshes a changed review and reports unavailable grants', async ({
  page,
  context,
  baseURL,
}, info) => {
  const f = fixture(info, true);
  await signIn(context, baseURL!, f.auth, f.owner.id);
  try {
    const view = await sharing(page, f);
    await view.choice.selectOption('viewer');
    await expect(view.checkbox).toBeEnabled();
    await view.checkbox.check();
    await expect(view.row.getByText('Research archive', { exact: true })).toBeVisible();
    await expect(view.row.getByText(/every current and future page and folder/)).toBeVisible();
    await expect(view.row.getByText('Survey results', { exact: true })).toBeVisible();
    await capture(page, view.row, info, 'external-space');
    f.spaces.updateChild(f.owner.id, f.space!.id, f.source.id, { name: 'Survey results revised' });
    await view.apply.click();
    await expect(view.row.getByRole('alert')).toContainText('Formula sources changed');
    await view.row.getByText('Source details', { exact: true }).click();
    await expect(view.row.getByText('Survey results revised', { exact: true })).toBeVisible();
    await expect(view.checkbox).not.toBeChecked();
    expect(f.grant(f.host.id)).toBeUndefined();
    expect(f.grant(f.space!.id)).toBeUndefined();
    await view.checkbox.check();
    await view.apply.click();
    await expect(
      view.row.getByRole('status').filter({ hasText: 'some sources still need access or review' }),
    ).toBeVisible();
    expect(f.grant(f.host.id)?.role).toBe('viewer');
    expect(f.grant(f.space!.id)?.role).toBe('viewer');
    expect(f.grant(f.source.id)).toBeUndefined();
    expect(f.grant(f.second.id)).toBeUndefined();
    await capture(page, view.row, info, 'partial');
    await expect(view.apply).toBeDisabled();
    const before = f.db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all();
    await view.dialog.getByRole('tab', { name: 'Link', exact: true }).click();
    await view.dialog.getByRole('button', { name: 'Create link', exact: true }).click();
    await expect(view.dialog.getByLabel('Guest link address', { exact: true })).toBeVisible();
    expect(f.db.prepare('SELECT * FROM workspace_grants ORDER BY item_id,user_id').all()).toEqual(
      before,
    );
    expect(f.workspace.links.state(f.space!.id)).toBeUndefined();
    expect(f.workspace.links.state(f.second.id)).toBeUndefined();
  } finally {
    await page.goto('/sign-in').catch(() => {});
    f.close();
  }
});

for (const includeSources of [false, true]) {
  test(`a lost ${includeSources ? 'source-sharing' : 'host-only'} acknowledgement refreshes actual access and never replays the grant`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const f = fixture(info);
    await signIn(context, baseURL!, f.auth, f.owner.id);
    let writes = 0;
    await page.route(`**/api/items/${f.host.id}/sharing`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      writes++;
      expect(Boolean(route.request().postDataJSON().sourceReview)).toBe(includeSources);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    });
    try {
      const view = await sharing(page, f);
      await view.choice.selectOption('viewer');
      await expect(view.checkbox).toBeEnabled();
      if (includeSources) await view.checkbox.check();
      await view.apply.click();
      await expect(view.row.getByRole('alert')).toContainText('Could not confirm the update');
      await expect(view.trigger).toContainText('View only');
      await expect(view.choice).toBeFocused();
      await expect(view.apply).toBeDisabled();
      const detailLabel = includeSources ? 'Already accessible (2)' : 'Source details';
      await view.row.getByText(detailLabel, { exact: true }).click();
      await expect(
        view.row
          .getByRole('list', { name: 'Reviewed source access' })
          .getByText(includeSources ? 'View only' : 'No access', { exact: true }),
      ).toBeVisible();
      expect(f.grant(f.host.id)?.role).toBe('viewer');
      expect(f.grant(f.source.id)?.role).toBe(includeSources ? 'viewer' : undefined);
      if (includeSources) await expect(view.checkbox).toHaveCount(0);
      else await expect(view.checkbox).not.toBeChecked();
      await view.row.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(view.trigger).toBeFocused();
      await view.trigger.click();
      await expect(view.choice).toHaveValue('viewer');
      await expect(view.apply).toBeDisabled();
      expect(writes).toBe(1);
    } finally {
      await page.goto('/sign-in').catch(() => {});
      f.close();
    }
  });
}

test('host-only refusal after File admin revocation removes previously reviewed source names', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = fixture(info);
  f.workspace.share(f.owner.id, f.host.id, f.other.id, 'admin');
  f.workspace.share(f.owner.id, f.source.id, f.other.id, 'admin');
  f.workspace.share(f.owner.id, f.second.id, f.other.id, 'viewer');
  await signIn(context, baseURL!, f.auth, f.other.id);
  await page.route(`**/api/items/${f.host.id}/sharing`, async (route) => {
    if (route.request().method() === 'PUT') {
      expect(route.request().postDataJSON().sourceReview).toBeUndefined();
      f.workspace.share(f.owner.id, f.host.id, f.other.id, null);
    }
    await route.continue();
  });
  try {
    const view = await sharing(page, f, true);
    await view.choice.selectOption('viewer');
    await view.row.getByText('Source details', { exact: true }).click();
    await expect(view.row.getByText(f.source.name, { exact: true })).toBeVisible();
    await expect(view.checkbox).not.toBeChecked();
    await view.apply.click();
    await expect(view.dialog.getByRole('alert')).toContainText(
      'Could not confirm the update or refresh access.',
    );
    await expect(view.dialog.getByText(f.source.name, { exact: true })).toHaveCount(0);
    await expect(view.dialog.getByText(f.recipient.name, { exact: true })).toHaveCount(0);
    expect(f.grant(f.host.id)).toBeUndefined();
    expect(f.grant(f.source.id)).toBeUndefined();
  } finally {
    await page.goto('/sign-in').catch(() => {});
    f.close();
  }
});
