import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';

const mode = process.argv[2];
if (mode !== 'controls' && mode !== 'corrected') throw new Error('Expected controls or corrected');
const directory = 'test-results/spn159';
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const server = await preview({
  configFile: false,
  root: resolve(directory, 'static'),
  build: { outDir: '.' },
  preview: { host: '127.0.0.1', port: 6019, strictPort: true },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: unknown[] = [];
const started = Date.now();
try {
  browser = await chromium.launch();
  for (const withheld of mode === 'controls' ? ['narrow', 'restore'] : ['none']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    try {
      await page.addInitScript((withheld) => {
        const probe = { withheld, clicks: [] as unknown[] };
        (window as unknown as { __spn159Probe: unknown }).__spn159Probe = probe;
        document.addEventListener('click', (event) => {
          const button = (event.target as Element).closest('button');
          const phase = button?.textContent?.trim() === 'Narrow editor' ? 'narrow'
            : button?.textContent?.trim() === 'Restore editor width' ? 'restore' : undefined;
          if (!phase) return;
          const host = document.querySelector<HTMLElement>('.rd-native-host')!;
          const output = document.querySelector('[data-native-drawing-capture]');
          probe.clicks.push({ phase, observation: JSON.parse(output?.textContent || '{}'), host: host.getBoundingClientRect().toJSON() });
          if (phase === withheld) {
            event.preventDefault();
            event.stopImmediatePropagation();
            // Withhold the intended width transition; only unrelated native height changes.
            host.style.height = 'calc(100% - 8px)';
          }
        }, true);
      }, withheld);
      await page.goto('http://127.0.0.1:6019/iframe.html?id=editor-sync-native--doc-drawing-capture&viewMode=story&globals=theme:light');
      await page.waitForFunction(() => {
        const preview = (window as unknown as { __STORYBOOK_PREVIEW__?: { channel?: { last: (event: string) => unknown[] } } }).__STORYBOOK_PREVIEW__;
        return preview?.channel?.last('storyFinished')?.length;
      }, undefined, { timeout: 60_000 });
      const result = await page.evaluate(() => {
        const preview = (window as unknown as { __STORYBOOK_PREVIEW__: { channel: { last: (event: string) => unknown[] } } }).__STORYBOOK_PREVIEW__;
        return {
          probe: (window as unknown as { __spn159Probe: unknown }).__spn159Probe,
          observation: JSON.parse(document.querySelector('[data-native-drawing-capture]')?.textContent || '{}'),
          finished: preview.channel.last('storyFinished'),
          playErrors: ['playFunctionThrewException', 'unhandledErrorsWhilePlaying'].map((event) => ({ event, errors: preview.channel.last(event) })),
        };
      });
      results.push({ withheld, result, errors });
      writeFileSync(`${directory}/${mode}-${withheld}.json`, JSON.stringify({ source, node: process.version, chromium: browser.version(), viewport: { width: 1280, height: 900 }, ...results.at(-1) as object }, null, 2));
      if (errors.length) throw new Error(`Unexpected page error in ${withheld}`);
      const control = result.probe as { clicks: { phase: string }[] };
      const failed = result.playErrors.some((event) => event.errors?.length);
      if (withheld === 'narrow' && !control.clicks.some((click) => click.phase === 'restore')) throw new Error('Old narrow counter wait did not accept unrelated native resize');
      if (withheld !== 'narrow' && failed) throw new Error(`Unexpected play failure in ${withheld}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
  writeFileSync(`${directory}/${mode}-receipt.json`, JSON.stringify({ source, node: process.version, elapsedMs: Date.now() - started, results }, null, 2));
}
