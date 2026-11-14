import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
import { iconSvg } from '../src/ui/appIcon.ts';
const directory = resolve('docs/implementation/evidence/SPN-090-current/visual');
await mkdir(directory, { recursive: true });
const server = await preview({ configFile: false, root: resolve('storybook-static'), build: { outDir: '.' }, preview: { host: '127.0.0.1', port: 6007, strictPort: true } });
const browser = await chromium.launch();
const captures: unknown[] = [];
try {
  for (const [theme, width, name] of [['light',1280,'light'],['dark',1280,'dark'],['light',390,'phone']] as const) {
    for (const id of ['current-production-startup-status--slow-start','offline-availability--protection-pending']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:6007/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
        await page.waitForFunction((id) => {
          const p = (window as any).__STORYBOOK_PREVIEW__;
          return p?.currentRender?.phase === 'finished' && p?.channel?.last('storyFinished')?.[0]?.storyId === id;
        }, id);
        const status = await page.evaluate(() => (window as any).__STORYBOOK_PREVIEW__.channel.last('storyFinished')[0].status);
        expect(status).toBe('success');
        if (id.includes('protection')) {
          await expect(page.getByRole('dialog', {name:'About device storage'})).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.getByText(/still deciding on storage protection/)).toBeVisible();
        } else await expect(page.getByRole('status')).toHaveText('Still starting: sign-in check (9 s)');
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const filename = `${id}-${name}.png`;
        await page.screenshot({ path: resolve(directory,filename), fullPage: true, animations:'disabled' });
        captures.push({ id, theme, width, height:900, filename, play:'success', afterGuidanceClosed:id.includes('protection') });
      } finally { await page.close(); }
    }
  }
  for (const size of [192,512]) {
    const filename = `installed-icon-${size}.png`;
    await sharp(Buffer.from(iconSvg())).resize(size,size).png().toFile(resolve(directory,filename));
    captures.push({filename,width:size,height:size,source:'production iconSvg(), same sharp path as vite installation assets',purpose:'any maskable',ownerOffset:2.5});
  }
  const files = ['web/StartupStage.stories.tsx','web/startupStage.ts','web/offline/OfflineAvailability.stories.tsx','web/offline/OfflineAvailability.tsx','web/offline/protection.ts','src/ui/appIcon.ts','src/ui/gemGeometry.ts','src/ui/palette.ts','.storybook/main.ts','.storybook/preview.tsx'];
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file,createHash('sha256').update(await readFile(file)).digest('hex')])));
  await writeFile(resolve(directory,'manifest.json'),JSON.stringify({format:1,build:'focused production Storybook; original main/preview, only StartupStage and OfflineAvailability catalog entries; not full hosted acceptance', sources,captures},null,2)+'\n');
  console.log(`Captured ${captures.length} current visuals; actual production stories, no page errors; icon192/512.`);
} finally { await browser.close(); await server.close(); }
