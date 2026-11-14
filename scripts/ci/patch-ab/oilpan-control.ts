import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { gcTraceNonOldSamples, nonOldGrowth } from '../../../e2e/doc-responsiveness-gc-trace.ts';

/**
 * SPN-146 control (never in required CI). The Doc's sustained-typing workload types into a bare
 * `contenteditable` div with no Univer and no Spinel code: the same sixteen paragraphs, Playwright
 * `keyboard.type` at zero delay, the same CPU throttle and the same `v8.gc` trace. It reports the memory V8's
 * global limit counts beyond the old generation (see `nonOldGrowth`), per second and per key, so the Doc's
 * figure can be read against what Chromium's typing path costs on its own.
 *
 *   node scripts/ci/patch-ab/oilpan-control.ts [throttle=4] [out.json] [idle]
 */
const throttle = Number(process.argv[2] ?? 4);
const out = process.argv[3];
const idle = process.argv[4] === 'idle';
const paragraphs = Array.from(
  { length: 16 },
  (_, index) =>
    `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
    'Keep the original page size and all of this text when navigating.',
);
const keys = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) + 15;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(
    '<div id=e contenteditable style="width:400px;height:300px;overflow:auto;font:16px sans-serif"></div>',
  );
  await page.focus('#e');
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
  const started = Date.now();
  if (idle) await page.waitForTimeout(43_000);
  else
    for (const [index, paragraph] of paragraphs.entries()) {
      await page.keyboard.type(paragraph);
      if (index < paragraphs.length - 1) await page.keyboard.press('Enter');
    }
  const seconds = (Date.now() - started) / 1000;
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
  const result = {
    kind: idle ? 'bare-contenteditable-idle' : 'bare-contenteditable-typing',
    throttle,
    keys: idle ? 0 : keys,
    typingSeconds: Math.round(seconds * 10) / 10,
    keysPerSecond: idle ? 0 : Math.round((keys / seconds) * 10) / 10,
    growth,
    allocatedKBPerKey:
      !idle && growth ? Math.round(((growth.allocatedMB * 1000) / keys) * 10) / 10 : null,
  };
  console.log(JSON.stringify(result));
  if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
} finally {
  await browser.close();
}
