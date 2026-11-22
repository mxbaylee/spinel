import { cp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { APIRequest } from '@playwright/test';
import { preparePlaywrightPatch } from './patch-playwright.ts';

/** Caller owns the temporary directory and must dispose every created context. */
export async function copyPlaywrightClient(directory: string, build: 'original' | 'patched') {
  const installed = resolve(import.meta.dirname, '../../node_modules/playwright-core');
  const source = await readFile(resolve(installed, 'lib/coreBundle.js'), 'utf8');
  const checked = preparePlaywrightPatch(source);
  await cp(installed, directory, { recursive: true });
  await writeFile(resolve(directory, 'lib/coreBundle.js'), checked[build]);
  return (createRequire(import.meta.url)(resolve(directory, 'index.js')) as { request: APIRequest })
    .request;
}
