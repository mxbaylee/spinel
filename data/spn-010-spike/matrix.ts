import { chromium, expect, type Page, type BrowserContext } from '@playwright/test';
import { appendFileSync, mkdirSync, copyFileSync } from 'node:fs';
const base = 'http://127.0.0.1:3110';
const run = new Date().toISOString().replaceAll(':', '-');
const output = `evidence/${run}`;
mkdirSync(output, { recursive: true });
const record = (event: string, detail: unknown) => {
  const row = { time: new Date().toISOString(), event, detail };
  appendFileSync(`${output}/observations.jsonl`, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
};
mkdirSync(`${output}/source`, { recursive: true });
for (const file of [
  'server.ts',
  'web.ts',
  'matrix.ts',
  'soak.ts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
])
  copyFileSync(file, `${output}/source/${file}`);
const browser = await chromium.launch();
record('start', {
  version: browser.version(),
  editPath: 'keyboard and name-box UI',
  license: 'none',
});
async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() =>
    (window as unknown as { readSpikeSnapshot: () => unknown }).readSpikeSnapshot(),
  );
}
async function open(ctx: BrowserContext, unit: string) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  p.on('pageerror', (e) => record('pageerror', { unit, message: e.message }));
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      record('console', { unit, type: m.type(), text: m.text() });
  });
  await p.goto(`${base}/?unit=${unit}`);
  await expect(p.locator('#status')).toContainText('Ready:', { timeout: 30000 });
  return p;
}
async function write(p: Page, unit: string, value: string, index: number) {
  await p.bringToFront();
  if (unit.startsWith('sheet-')) {
    const box = p.getByRole('textbox').nth(2);
    await box.fill(`A${index + 1}`);
    await box.press('Enter');
    await p.keyboard.type(value);
    await p.keyboard.press('Enter');
  } else {
    await p.keyboard.press('Control+End');
    await p.keyboard.insertText(value + ' ');
  }
}
function content(data: any, unit: string) {
  if (unit.startsWith('doc-')) return data.body.dataStream;
  const cells = structuredClone(data.sheets.tab1.cellData);
  for (const row of Object.values(cells))
    for (const cell of Object.values(row as object))
      if (typeof cell.s === 'string') cell.s = data.styles[cell.s];
  return cells;
}
function contains(data: any, unit: string, value: string, index: number) {
  return unit.startsWith('doc-')
    ? data.body?.dataStream?.includes(value)
    : data.sheets?.tab1?.cellData?.[index]?.[0]?.v === value;
}
let failures = 0;
async function scenario(editors: number, units: string[]) {
  const contexts: BrowserContext[] = [];
  const allPages: Page[] = [];
  const label = `${editors}editors-${units.length}units`;
  record('scenario-start', { label, units });
  try {
    for (let i = 1; i <= editors; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await ctx.addCookies([{ name: 'spike-user', value: `user-${i}`, url: base }]);
      contexts.push(ctx);
    }
    const groups = new Map<string, Page[]>();
    for (const unit of units) {
      const pages = [];
      for (const ctx of contexts) {
        const p = await open(ctx, unit);
        pages.push(p);
        allPages.push(p);
      }
      groups.set(unit, pages);
    }
    for (let cycle = 0; cycle < 3; cycle++)
      for (const [unit, pages] of groups)
        for (let i = 0; i < editors; i++) {
          const value = `s${run}-${label}-${cycle}-${i}`;
          const row = cycle * editors + i;
          await write(pages[i], unit, value, row);
          for (const p of pages)
            await expect
              .poll(async () => contains(await snapshot(p), unit, value, row), { timeout: 15000 })
              .toBeTruthy();
          record('edit-converged', { label, unit, editor: i + 1, cycle, value });
        }
    for (const [unit, pages] of groups) {
      const tokens = pages.map((_, i) => `burst-${run}-${label}-${i}`);
      await Promise.all(pages.map((p, i) => write(p, unit, tokens[i], 3 * editors + i)));
      for (const p of pages)
        await expect
          .poll(
            async () => {
              const data = await snapshot(p);
              return tokens.every((value, i) => contains(data, unit, value, 3 * editors + i));
            },
            { timeout: 15000 },
          )
          .toBeTruthy();
      for (const p of pages) {
        const data = await snapshot(p);
        for (let cycle = 0; cycle < 3; cycle++)
          for (let i = 0; i < editors; i++)
            expect(
              contains(data, unit, `s${run}-${label}-${cycle}-${i}`, cycle * editors + i),
            ).toBeTruthy();
      }
      record('burst-converged', { label, unit, tokens });
      const expected = content(await snapshot(pages[0]), unit);
      for (const p of pages) expect(content(await snapshot(p), unit)).toEqual(expected);
      await pages[0].screenshot({ path: `${output}/${label}-${unit}.png` });
      record('ui', { label, unit, text: await pages[0].locator('body').innerText() });
      const before = await snapshot(pages[0]);
      await pages[0].reload();
      await expect(pages[0].locator('#status')).toContainText('Ready:', { timeout: 30000 });
      const after = await snapshot(pages[0]);
      expect(content(after, unit)).toEqual(content(before, unit));
    }
    record('scenario-pass', { label });
  } catch (error) {
    failures++;
    record('scenario-failure', { label, error: String(error) });
    for (let i = 0; i < allPages.length; i++)
      await allPages[i].screenshot({ path: `${output}/${label}-failure-${i}.png` }).catch(() => {});
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
}
try {
  for (const n of [2, 3, 4, 6]) await scenario(n, ['sheet-1', 'doc-1']);
  await scenario(2, ['sheet-1', 'doc-1', 'sheet-2', 'doc-2', 'sheet-3', 'doc-3']);
  record('complete', { failedScenarios: failures });
  if (failures) process.exitCode = 1;
} finally {
  await browser.close();
}
