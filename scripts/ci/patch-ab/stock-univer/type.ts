import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { gcTraceNonOldSamples, nonOldGrowth } from '../../../../e2e/doc-responsiveness-gc-trace.ts';

/**
 * SPN-146 comparison (never in required CI). Types the Doc workload's sixteen paragraphs into a stock Univer
 * Doc (`UniverDocsCorePreset`, no Spinel plugin, sync, presence or phone view; desktop UI) at the same CPU
 * throttle, and reports the memory V8's global limit counts beyond the old generation per key, like
 * `oilpan-control.ts` does for a bare page and the sustained-typing spec's GC trace does for the Doc.
 *
 *   node scripts/ci/patch-ab/stock-univer/type.ts [throttle=4] [out.json]
 */
const throttle = Number(process.argv[2] ?? 4);
const out = process.argv[3];
const root = import.meta.dirname;
await build({ configFile: `${root}/vite.config.ts`, logLevel: 'error' });
const server = await preview({ configFile: `${root}/vite.config.ts` });
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:4999/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready);
  await page.waitForTimeout(2500);
  await page.mouse.click(500, 300);
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const complete = new Promise<string>((resolve) =>
    cdp.once('Tracing.tracingComplete', (event: { stream?: string }) =>
      resolve(event.stream ?? ''),
    ),
  );
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    streamFormat: 'json',
    traceConfig: {
      recordMode: 'recordUntilFull',
      includedCategories: ['v8.gc', 'disabled-by-default-v8.gc'],
    },
  });
  const paragraphs = Array.from(
    { length: 16 },
    (_, index) =>
      `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
      'Keep the original page size and all of this text when navigating.',
  );
  const keys = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) + 15;
  const started = Date.now();
  for (const [index, paragraph] of paragraphs.entries()) {
    await page.keyboard.type(paragraph);
    if (index < paragraphs.length - 1) await page.keyboard.press('Enter');
  }
  const seconds = (Date.now() - started) / 1000;
  const documentLength = await page.evaluate(() => (window as any).__len());
  await cdp.send('Tracing.end');
  const stream = await complete;
  let text = '';
  for (let eof = false; !eof;) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    text += chunk.data;
    eof = chunk.eof;
  }
  const events = JSON.parse(text).traceEvents as any[];
  const pid = events.find((event) => event.name === 'V8.GCTraceGCNVP')?.pid ?? -1;
  const growth = nonOldGrowth(gcTraceNonOldSamples(events, pid));
  const majors = events.filter(
    (event) => event.name === 'V8.GC_MARK_COMPACTOR' && event.pid === pid && event.dur >= 5000,
  ).length;
  const result = {
    kind: 'stock-univer-doc-typing',
    throttle,
    keys,
    documentLength,
    typingSeconds: Math.round(seconds * 10) / 10,
    keysPerSecond: Math.round(keys / seconds),
    growth,
    allocatedKBPerKey: growth ? Math.round(((growth.allocatedMB * 1000) / keys) * 10) / 10 : null,
    majorsOfAtLeast5ms: majors,
  };
  console.log(JSON.stringify(result));
  if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
} finally {
  await browser.close();
  await server.close();
}
