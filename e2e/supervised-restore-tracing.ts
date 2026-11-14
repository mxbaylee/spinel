import { test as base } from '@playwright/test';
import type { BrowserContext, TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
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
