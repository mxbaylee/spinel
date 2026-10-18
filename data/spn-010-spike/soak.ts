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
const contexts: BrowserContext[] = [];
const groups = new Map<string, Page[]>();
const retained = new Map<string, Map<number, string>>();
const docTokens: string[] = [];
const minutes = Number(process.env.SPN_SOAK_MINUTES ?? 1500);
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Invalid duration');
const duration = minutes * 60000;
let start = 0,
  monoStart = 0,
  lastWall = 0,
  lastMono = 0,
  tick = 0;
async function verify(p: Page, unit: string) {
  const data = await snapshot(p);
  if (unit.startsWith('doc-'))
    expect(docTokens.every((token) => data.body.dataStream.includes(token))).toBeTruthy();
  else
    for (const [row, value] of retained.get(unit) ?? [])
      expect(contains(data, unit, value, row)).toBeTruthy();
}
try {
  for (let i = 1; i <= 2; i++) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await c.addCookies([{ name: 'spike-user', value: `user-${i}`, url: base }]);
    contexts.push(c);
  }
  for (const unit of ['sheet-12', 'doc-12']) {
    const pages = [];
    for (const c of contexts) pages.push(await open(c, unit));
    groups.set(unit, pages);
    retained.set(unit, new Map());
  }
  start = Date.now();
  monoStart = performance.now();
  lastWall = start;
  lastMono = monoStart;
  record('soak-start', {
    targetMinutes: minutes,
    pid: process.pid,
    acceptanceEligible: minutes >= 1500,
  });
  while (true) {
    const wall = Date.now(),
      mono = performance.now();
    const wallDelta = wall - lastWall,
      monoDelta = mono - lastMono;
    if (
      wallDelta > 120000 ||
      monoDelta > 120000 ||
      wallDelta < 0 ||
      Math.abs(wallDelta - monoDelta) > 10000
    )
      throw new Error(
        `Insufficient continuous evidence: gap/clock change ${wallDelta}/${monoDelta} ms`,
      );
    lastWall = wall;
    lastMono = mono;
    const final = wall - start >= duration && mono - monoStart >= duration;
    for (const [unit, pages] of groups) {
      const values = pages.map((_, i) => `soak-${run}-${tick}-${i}`);
      await Promise.all(pages.map((p, i) => write(p, unit, values[i], (tick * 2 + i) % 1000)));
      for (let i = 0; i < 2; i++) {
        if (unit.startsWith('doc-')) docTokens.push(values[i]);
        else retained.get(unit)!.set((tick * 2 + i) % 1000, values[i]);
        for (const p of pages)
          await expect
            .poll(async () => contains(await snapshot(p), unit, values[i], (tick * 2 + i) % 1000), {
              timeout: 15000,
            })
            .toBeTruthy();
        record('edit-converged', { unit, user: i + 1, tick, value: values[i] });
      }
      for (const p of pages) await verify(p, unit);
      const expected = content(await snapshot(pages[0]), unit);
      for (const p of pages) expect(content(await snapshot(p), unit)).toEqual(expected);
    }
    if (tick % 60 === 0 || final)
      for (const [unit, pages] of groups) {
        await pages[0].reload();
        await expect(pages[0].locator('#status')).toContainText('Ready:', { timeout: 30000 });
        await verify(pages[0], unit);
        await pages[0].screenshot({ path: `${output}/soak-${unit}-${tick}.png` });
        record('ui', { unit, tick, text: await pages[0].locator('body').innerText() });
      }
    if (
      Date.now() - lastWall > 120000 ||
      performance.now() - lastMono > 120000 ||
      Math.abs(Date.now() - lastWall - (performance.now() - lastMono)) > 10000
    )
      throw new Error('Insufficient continuous evidence: interruption during verification');
    record('heartbeat', {
      tick,
      elapsedMs: Date.now() - start,
      monotonicMs: performance.now() - monoStart,
    });
    tick++;
    if (final) {
      record(minutes >= 1500 ? 'soak-complete' : 'pilot-complete', {
        elapsedMs: Date.now() - start,
        monotonicMs: performance.now() - monoStart,
        ticks: tick,
      });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
} catch (error) {
  record('soak-failure', {
    error: String(error),
    elapsedMs: start ? Date.now() - start : 0,
    ticks: tick,
  });
  process.exitCode = 1;
  for (const [unit, pages] of groups)
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: `${output}/failure-${unit}-${i}.png` }).catch(() => {});
      record('failure-ui', {
        unit,
        user: i + 1,
        text: await pages[i]
          .locator('body')
          .innerText()
          .catch(() => '<unavailable>'),
      });
    }
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
}
