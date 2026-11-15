import { test as runner, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { test, startRestoreTrace, retainRestoreTrace } from '/Users/mxbaylee/projects/spinel-spn-128-production/e2e/supervised-restore-tracing.ts';

test('sole manual owner retains complete original journey for both manual contexts', async ({ playwright }, info) => {
  const browser = await playwright.chromium.launch();
  try {
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext();
      await startRestoreTrace(context);
      const page = await context.newPage();
      await page.setContent('<button onclick="document.body.dataset.clicked=\'yes\'">Record journey</button>');
      await page.getByRole('button', { name: 'Record journey' }).click();
      await expect(page.locator('body')).toHaveAttribute('data-clicked', 'yes');
      const path = await retainRestoreTrace(context, info, index);
      expect(path).toMatch(/restore-first-failure-\d\/trace\.zip$/);
      const members = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).split('\n');
      const events = members.filter(x => x.endsWith('.trace')).map(x => execFileSync('unzip', ['-p', path, x], { encoding: 'utf8' })).join('\n');
      expect(events).toContain('context-options');
      expect(events).toContain('setContent');
      expect(events).toContain('click');
      expect(events).toContain('"type":"after"');
      await context.close();
    }
  } finally { await browser.close(); }
});

const competing = runner.extend({ trace: 'retain-on-failure' as const });
competing('withheld old dual-owner setting is rejected before navigation', async ({ playwright }) => {
  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext();
    await expect(startRestoreTrace(context)).rejects.toThrow(/already started/);
  } finally { await browser.close(); }
});
