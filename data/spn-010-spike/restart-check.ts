import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') throw new Error('Use before or after');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: 'spike-user', value: 'user-77', url: 'http://127.0.0.1:3110' }]);
const result: Record<string, unknown> = {};
try {
  for (const unit of ['sheet-1', 'doc-1']) {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:3110/?unit=${unit}`);
    await expect(page.locator('#status')).toContainText('Ready:', { timeout: 30000 });
    const data: any = await page.evaluate(() =>
      (window as unknown as { readSpikeSnapshot: () => unknown }).readSpikeSnapshot(),
    );
    if (unit.startsWith('doc-')) result[unit] = data.body;
    else {
      const cells = structuredClone(data.sheets.tab1.cellData);
      for (const row of Object.values(cells))
        for (const cell of Object.values(row as object))
          if (typeof cell.s === 'string') cell.s = data.styles[cell.s];
      result[unit] = cells;
    }
    await page.screenshot({ path: `restart-${phase}-${unit}.png` });
    await page.close();
  }
  if (phase === 'before') writeFileSync('restart-baseline.json', JSON.stringify(result));
  else expect(result).toEqual(JSON.parse(readFileSync('restart-baseline.json', 'utf8')));
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      phase,
      result: 'passed',
      units: Object.keys(result),
    }),
  );
} finally {
  await browser.close();
}
