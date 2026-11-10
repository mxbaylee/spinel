import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { arch, platform, release } from 'node:os';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { startNativeDiagnosticTrace } from '../../../e2e/doc-responsiveness-native-trace.ts';
import { callbackProgress } from '../../../e2e/doc-responsiveness-callback-progress.ts';
const root = process.cwd(),
  out = process.env.SPN146_RUNTIME_OUTPUT ?? 'test-results/spn146-native-runtime';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const progress = callbackProgress(out + '/progress.json');
const controller = new AbortController();
const record: any = {
  diagnosticOnly: true,
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  startedAt: performance.now(),
  platform: { platform: platform(), arch: arch(), release: release() },
  complete: false,
};
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  cdp: CDPSession | undefined,
  page: Page | undefined;
let detached: Promise<void> | undefined,
  contextClosed: Promise<void> | undefined,
  browserClosed: Promise<void> | undefined;
let failure: unknown, trace: Awaited<ReturnType<typeof startNativeDiagnosticTrace>> | undefined;
const detach = () => (cdp ? (detached ??= cdp.detach()) : Promise.resolve());
const closeContext = () => (context ? (contextClosed ??= context.close()) : Promise.resolve());
const closeBrowser = () => (browser ? (browserClosed ??= browser.close()) : Promise.resolve());
const interrupt = () => Promise.allSettled([detach(), closeContext(), closeBrowser()]);
// Leave10seconds for caller-owned interruption/teardown inside the parent's60s bound.
const deadline = setTimeout(() => {
  controller.abort(new Error('Runtime observation reached50second work deadline.'));
  void interrupt();
}, 50_000);
try {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted-only allowance');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
  assert.equal(record.source, process.env.SPN146_REVIEWED_HEAD);
  assert.equal(platform(), 'linux');
  const preparationBytes = await readFile(out + '/preparation.json'),
    preparation = JSON.parse(preparationBytes.toString());
  record.preparationSha256 = hash(preparationBytes);
  assert.equal(preparation.source, record.source);
  const bundle = await readFile(out + '/bundle/runtime.js');
  assert.equal(hash(bundle), preparation.bundleSha256);
  assert.equal(bundle.length, preparation.bundleBytes);
  record.bundleSha256 = preparation.bundleSha256;
  // Recheck the entire declared real-file bundle closure immediately before use.
  for (const module of preparation.modules)
    if (!module.virtual) {
      const bytes = await readFile(module.path);
      assert.equal(bytes.length, module.bytes);
      assert.equal(hash(bytes), module.sha256, module.path);
    }
  record.dependencyClosureVerified = true;
  const executable = chromium.executablePath(),
    binaryHash = createHash('sha256');
  for await (const chunk of createReadStream(executable)) binaryHash.update(chunk);
  record.executable = { path: executable, sha256: binaryHash.digest('hex') };
  record.harness = Object.fromEntries(
    await Promise.all(
      [
        'e2e/doc-responsiveness-native-trace.ts',
        'e2e/doc-responsiveness-callback-trace.ts',
        'e2e/doc-responsiveness-callback-progress.ts',
      ].map(async (path) => [path, hash(await readFile(root + '/' + path))]),
    ),
  );
  controller.signal.throwIfAborted();
  progress.phase('browser-start');
  browser = await chromium.launch({ headless: true, executablePath: executable, timeout: 15_000 });
  record.browserVersion = browser.version();
  assert.equal(record.browserVersion, '156.0.8078.4');
  browser.on('disconnected', () => {
    if (!browserClosed) progress.lifecycle('browser-disconnected');
  });
  controller.signal.throwIfAborted();
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on('pageerror', (error) => {
    record.pageErrors ??= [];
    record.pageErrors.push(String(error));
    progress.failed('operation');
  });
  page.on('crash', () => progress.lifecycle('page-crash'));
  controller.signal.throwIfAborted();
  await page.addScriptTag({ content: bundle.toString() });
  cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  record.throttle = { requested: 4, acknowledged: true };
  controller.signal.throwIfAborted();
  trace = await startNativeDiagnosticTrace(cdp, out + '/runtime.pftrace.gz', progress, {
    signal: controller.signal,
    interrupt: detach,
  });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  const before = await page.evaluate(() => performance.now());
  await cdp.send('Profiler.start');
  const after = await page.evaluate(() => performance.now());
  record.profilerBracket = { before, after };
  progress.phase('fixed32-observations');
  const observed = await page.evaluate(() => (window as any).SPN146NativeRuntime.run());
  record.observation = observed;
  assert.equal(observed.finished, true);
  assert.equal(observed.records.length, 32);
  controller.signal.throwIfAborted();
  // The control comes after all native timings. It verifies category observability.
  progress.phase('post-observation-gc-control');
  const gcStart = await page.evaluate(() => ({
    name: 'spn146-runtime-gc-control-start',
    time: performance.mark('spn146-runtime-gc-control-start').startTime,
  }));
  await cdp.send('HeapProfiler.collectGarbage');
  const gcEnd = await page.evaluate(() => ({
    name: 'spn146-runtime-gc-control-end',
    time: performance.mark('spn146-runtime-gc-control-end').startTime,
  }));
  record.gcControl = { gcStart, gcEnd };
  const profile = await cdp.send('Profiler.stop');
  const profileBytes = JSON.stringify(profile.profile);
  await writeFile(out + '/runtime.cpuprofile', profileBytes, { flag: 'wx' });
  record.profileSha256 = hash(profileBytes);
  record.trace = await trace.finish();
  controller.signal.throwIfAborted();
  assert.equal(record.trace.complete, true);
  assert.equal(progress.firstFailure, null);
  assert.equal(progress.persistenceFailure, null);
  assert.deepEqual(record.pageErrors ?? [], []);
  record.collectionComplete = true;
} catch (error) {
  failure = error;
  record.failure = String(error);
  progress.failed('operation');
  // Retrieve existing state only. Crash/hard termination may prevent this;
  // the same deadline/owned interruption remains active, and run is never retried.
  if (page && !page.isClosed() && !controller.signal.aborted) {
    try {
      record.observation = await page.evaluate(
        () => (window as any).SPN146NativeRuntime?.inspect() ?? null,
      );
      record.partialRetrieved = true;
    } catch (retrievalError) {
      record.partialRetrievalFailure = String(retrievalError);
    }
  } else record.partialRetrievalUnavailable = 'Page closed or owned deadline interrupted execution';
} finally {
  if (trace)
    try {
      record.trace ??= await trace.finish();
    } catch (error) {
      failure ??= error;
      record.traceFailure = String(error);
    }
  progress.cleanup();
  const cleanup: PromiseSettledResult<void>[] = [];
  for (const close of [detach, closeContext, closeBrowser]) {
    try {
      await close();
      cleanup.push({ status: 'fulfilled', value: undefined });
    } catch (reason) {
      cleanup.push({ status: 'rejected', reason });
    }
  }
  record.cleanup = cleanup.map((value, index) => ({
    resource: ['cdp', 'context', 'browser'][index],
    status: value.status,
    ...(value.status === 'rejected' ? { error: String(value.reason) } : {}),
  }));
  for (const value of cleanup) if (value.status === 'rejected') failure ??= value.reason;
  if (controller.signal.aborted) failure ??= controller.signal.reason;
  clearTimeout(deadline);
  record.elapsedMs = performance.now() - record.startedAt;
  if (record.elapsedMs >= 60_000) failure ??= new Error('Runtime exceeded total60second bound.');
  if (progress.firstFailure || progress.persistenceFailure)
    failure ??= new Error('Runtime lifecycle/progress failed.');
  progress.terminal(failure ? 'failed' : 'passed');
  if (progress.persistenceFailure || progress.firstFailure)
    failure ??= new Error('Terminal progress persistence/lifecycle failed');
  record.complete = !failure;
  record.failure ??= failure ? String(failure) : null;
  await writeFile(out + '/observation.json', JSON.stringify(record, null, 2) + '\n', {
    flag: 'wx',
  }).catch((error) => {
    failure ??= error;
  });
  if (failure) progress.terminal('failed');
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    complete: record.complete,
    elapsedMs: record.elapsedMs,
    observations: record.observation.records.length,
    browser: record.browserVersion,
    bundleSha256: record.bundleSha256,
  }),
);
