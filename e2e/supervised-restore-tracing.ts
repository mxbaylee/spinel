import { test as base } from '@playwright/test';
import type { Browser, BrowserContext, TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// These journeys create contexts manually. One owner records every attempt from
// before navigation; runner tracing must not start a second trace on that context.
export const test = base.extend({ trace: 'off' as const });
export const startRestoreTrace = (context: BrowserContext) =>
  context.tracing.start({ screenshots: true, snapshots: true });

export async function retainRestoreTrace(context: BrowserContext, info: TestInfo, index: number) {
  const path = info.outputPath(`restore-first-failure-${index}`, 'trace.zip');
  await mkdir(dirname(path), { recursive: true });
  await context.tracing.stop({ path });
  await info.attach(`restore-first-failure-${index}`, { path, contentType: 'application/zip' });
  return path;
}

/** Persist bytes under the upload owner's basename before attaching a reporter copy. */
export async function retainRestoreAttachment(
  info: TestInfo,
  name: string,
  extension: 'json' | 'png' | 'txt',
  body: string | Buffer,
  contentType: string,
) {
  const path = info.outputPath(`${name}.${extension}`);
  await writeFile(path, body);
  await info.attach(name, { path, contentType });
  return path;
}

export async function retainRestoreFailure(
  browser: Browser | undefined,
  info: TestInfo,
  startupEvidence: WeakMap<BrowserContext, string[]>,
  primary: unknown,
) {
  const collectionFailures: string[] = [];
  const errors: unknown[] = [];
  const capture = async (name: string, collect: () => Promise<unknown>) => {
    try {
      await collect();
    } catch (error) {
      errors.push(error);
      // A broken context/trace or attachment must not replace the test's
      // original rejection or prevent evidence from other contexts/pages.
      collectionFailures.push(name);
    }
  };
  let contextIndex = 0;
  for (const context of browser?.contexts() ?? []) {
    const index = contextIndex++;
    await capture(`startup-${index}`, () =>
      retainRestoreAttachment(
        info,
        `restore-startup-${index}`,
        'json',
        JSON.stringify(startupEvidence.get(context) ?? [], null, 2),
        'application/json',
      ),
    );
    await capture(`trace-${index}`, async () => {
      await retainRestoreTrace(context, info, index);
    });
    let pageIndex = 0;
    for (const page of context.pages()) {
      const id = `${index}-${pageIndex++}`;
      if (page.isClosed()) continue;
      await capture(`screenshot-${id}`, async () =>
        retainRestoreAttachment(
          info,
          `restore-failure-${id}`,
          'png',
          await page.screenshot({ animations: 'disabled' }),
          'image/png',
        ),
      );
      await capture(`state-${id}`, async () =>
        retainRestoreAttachment(
          info,
          `restore-state-${id}`,
          'txt',
          await page.locator('body').ariaSnapshot(),
          'text/plain',
        ),
      );
    }
  }
  if (collectionFailures.length)
    await capture('collection-failure-attachment', () =>
      retainRestoreAttachment(
        info,
        'restore-diagnostic-collection-failures',
        'json',
        JSON.stringify(collectionFailures),
        'application/json',
      ),
    );
  return errors.length
    ? new AggregateError([primary, ...errors], 'Restore failed and evidence capture also failed.', {
        cause: primary,
      })
    : primary;
}
