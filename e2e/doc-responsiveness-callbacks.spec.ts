import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import {
  analyzeDocCallbackLifetimes,
  DOC_CALLBACK_MARKERS,
} from '../scripts/ci/doc-callback-lifetimes.ts';
import { attributeDocCallbackSources } from './doc-responsiveness-callback-sources.ts';
import { fixture, focusEmptyDoc, exactText, saved, online } from './doc-responsiveness-fixture.ts';
import { observeInput, readDocResponsiveness } from './doc-responsiveness.ts';

// Separate traced observations preserve all existing unprofiled SPN-108 gates.
const paragraphs = Array.from(
  { length: 16 },
  (_, index) =>
    `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
    'Keep the original page size and all of this text when navigating.',
);
const expectedText = paragraphs.join('\r') + '\r\n';
const expectedKeydowns = 2086;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const baseline = process.env.SPN113_BASELINE === '1';
const categories = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline.stack',
  'toplevel',
  'v8',
  'blink.user_timing',
  'disabled-by-default-renderer.scheduler',
];
const harnessPaths = [
  'e2e/doc-responsiveness-callbacks.spec.ts',
  'e2e/doc-responsiveness-callback-sources.ts',
  'e2e/doc-responsiveness-fixture.ts',
  'e2e/doc-responsiveness.ts',
  'scripts/ci/doc-callback-lifetimes.ts',
  'web/docResponsivenessEvidence.ts',
  'web/DocEditor.tsx',
  'playwright.config.ts',
  'package-lock.json',
];

interface SelectionEvidence {
  unitId: string;
  start?: number;
  end?: number;
  anchor: { visible: boolean; stroke: string | null; width: number; height: number } | null;
  scale: { x: number; y: number };
  commands: Array<{ id: string; unitId?: string; zoomRatio?: number }>;
}

async function selection(page: Page) {
  return page.evaluate(() => {
    let result: SelectionEvidence | null = null;
    const receive = (event: Event) => {
      result = (event as CustomEvent<SelectionEvidence>).detail;
    };
    window.addEventListener('spinel-doc-selection-evidence', receive);
    try {
      window.dispatchEvent(new Event('spinel-doc-selection-read'));
    } finally {
      window.removeEventListener('spinel-doc-selection-evidence', receive);
    }
    return result;
  }) as Promise<SelectionEvidence | null>;
}

async function retainTrace(cdp: CDPSession, path: string) {
  const completed = new Promise<{ stream?: string; dataLossOccurred?: boolean }>((resolve) =>
    cdp.once('Tracing.tracingComplete', resolve),
  );
  await cdp.send('Tracing.end');
  const completion = await completed;
  if (!completion.stream) throw new Error('Tracing completed without its raw stream.');
  await writeFile(path, '');
  const checksum = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: completion.stream, size: 1024 * 1024 });
      const value = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
      checksum.update(value);
      bytes += value.length;
      await appendFile(path, value);
      if (chunk.eof) break;
    }
  } finally {
    await cdp.send('IO.close', { handle: completion.stream });
  }
  return { file: basename(path), completion, bytes, sha256: checksum.digest('hex') };
}

test.describe.configure({ retries: 0, mode: 'default' });
for (const preset of ['desktop', 'mobile'] as const)
  test(`${preset} native callback lifetimes`, async ({ browser, baseURL }, info) => {
    test.setTimeout(420_000);
    const mobile = preset === 'mobile';
    const f = await fixture(browser, baseURL!, info, mobile);
    // One measured renderer. The existing responsiveness suite separately keeps
    // all two-editor convergence, Undo/Redo, renewed-input and permission gates.
    await f.second.close();
    const page = f.page;
    const cdp = await page.context().newCDPSession(page);
    let tracing = false;
    let frameId = '';
    let failure: unknown;
    let finishInput: Awaited<ReturnType<typeof observeInput>> | undefined;
    const output = info.outputPath('spn113-evidence.json');
    const evidence: Record<string, unknown> = {
      schema: 1,
      role: baseline ? 'baselineObservation' : 'candidate',
      preset,
      attempt: info.retry,
      runner: {
        run: process.env.GITHUB_RUN_ID ?? null,
        attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        name: process.env.RUNNER_NAME ?? 'local',
      },
      source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirtyPaths: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
      browser: browser.version(),
      runtime: process.version,
      playwright: JSON.parse(await readFile('node_modules/@playwright/test/package.json', 'utf8'))
        .version,
      harnessSha256: Object.fromEntries(
        await Promise.all(harnessPaths.map(async (path) => [path, hash(await readFile(path))])),
      ),
      fixture: {
        paragraphs: 16,
        typedCharacters: 2071,
        enterKeys: 15,
        nativeKeydowns: expectedKeydowns,
        nativeTextLength: expectedText.length,
        sha256: hash(expectedText),
        input: 'keyboard.type, zero requested delay; Enter between all sixteen paragraphs',
      },
      instrumentation: {
        categories,
        sourceMaps: 'hidden; exact built bundle source content',
        cpuThrottle: mobile ? 4 : 1,
        mountedEditors: 1,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        touch: mobile,
        deviceScaleFactor: 1,
        playwrightTrace: false,
        latencyBudgetsEnforced: false,
        postDisposalMs: 1200,
        buildFlags: {
          VITE_DOC_RESPONSIVENESS_EVIDENCE: '1',
          VITE_DOC_SELECTION_EVIDENCE: '1',
          VITE_SYNC_EVIDENCE: '0',
        },
      },
      heapLimitations: 'Renderer heap snapshots without forced GC; not retained-object ownership.',
      complete: false,
      passed: false,
    };
    const persist = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
    try {
      evidence.phase = 'before-navigation';
      await persist();
      const bufferUsage: unknown[] = [];
      cdp.on('Tracing.bufferUsage', (event) => bufferUsage.push(event));
      evidence.traceBufferUsage = bufferUsage;
      evidence.traceCategoryEnumeration = await cdp.send('Tracing.getCategories');
      // Capture before the first app navigation, including shell timer installs.
      await cdp.send('Tracing.start', {
        categories: categories.join(','),
        transferMode: 'ReturnAsStream',
        streamFormat: 'json',
        bufferUsageReportingInterval: 1000,
      });
      tracing = true;
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
      frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      evidence.frameId = frameId;
      evidence.timeOrigin = timeOrigin;
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
      await page.evaluate((name) => void performance.mark(name), DOC_CALLBACK_MARKERS.beforeMount);
      await page.getByRole('button', { name: `${f.item.name} Doc`, exact: true }).click();
      await Promise.all([saved(page), online(page)]);
      await focusEmptyDoc(page, mobile);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      expect((await readDocResponsiveness(page))?.mobile).toBe(mobile);
      evidence.environment = await page.evaluate(() => ({
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        devicePixelRatio,
        maxTouchPoints: navigator.maxTouchPoints,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      }));
      expect((evidence.environment as { coarsePointer: boolean }).coarsePointer).toBe(mobile);
      evidence.heapBefore = await cdp.send('Runtime.getHeapUsage');
      finishInput = await observeInput(page);
      const keys = await page.evaluateHandle(
        ({ count, names }) => {
          let observed = 0;
          const receive = (event: KeyboardEvent) => {
            if (
              !(event.target instanceof Element) ||
              !event.target.closest('[contenteditable="true"][data-u-comp="editor"]')
            )
              return;
            observed++;
            if (observed === 1) performance.mark(names.inputStart);
            if (observed === count) performance.mark(names.finalKey);
          };
          document.addEventListener('keydown', receive, true);
          return () => {
            document.removeEventListener('keydown', receive, true);
            return observed;
          };
        },
        { count: expectedKeydowns, names: DOC_CALLBACK_MARKERS },
      );
      evidence.phase = 'typing';
      await persist();
      const typingStarted = performance.now();
      for (const [index, paragraph] of paragraphs.entries()) {
        if (index > 0) await page.keyboard.press('Enter');
        await page.keyboard.type(paragraph);
      }
      evidence.typingWallMs = performance.now() - typingStarted;
      evidence.observedKeydowns = await keys.evaluate((stop) => stop());
      await keys.dispose();
      expect(evidence.observedKeydowns).toBe(expectedKeydowns);
      evidence.input = await finishInput();
      finishInput = undefined;
      await expect
        .poll(async () => (await readDocResponsiveness(page))?.pending, {
          timeout: 60_000,
        })
        .toEqual({ history: 0, collaboration: 0 });
      await exactText(page, expectedText);
      await saved(page);
      expect((await f.read()).body?.dataStream).toBe(expectedText);
      const native = await readDocResponsiveness(page, true);
      evidence.nativeAfterTyping = native;
      evidence.textSha256 = hash(native!.text!);
      expect(native?.selection).toMatchObject({ start: 2086, end: 2086 });

      // Read only the current public graphic during idle frames. No timer wrappers,
      // SDK field changes, synthetic selections or per-key native snapshots.
      evidence.phase = 'live-caret';
      const blink = await page.evaluate(
        () =>
          new Promise<Array<{ at: number; visible: boolean; stroke: string | null }>>((resolve) => {
            const samples: Array<{ at: number; visible: boolean; stroke: string | null }> = [];
            const started = performance.now();
            const receive = (event: Event) => {
              const anchor = (event as CustomEvent<SelectionEvidence>).detail.anchor;
              if (anchor)
                samples.push({
                  at: performance.now(),
                  visible: anchor.visible,
                  stroke: anchor.stroke,
                });
            };
            window.addEventListener('spinel-doc-selection-evidence', receive);
            const sample = () => {
              window.dispatchEvent(new Event('spinel-doc-selection-read'));
              if (performance.now() - started < 2200) requestAnimationFrame(sample);
              else {
                window.removeEventListener('spinel-doc-selection-evidence', receive);
                resolve(samples);
              }
            };
            requestAnimationFrame(sample);
          }),
      );
      evidence.blink = blink;
      expect(blink.length).toBeGreaterThan(2);
      expect(blink.every((sample) => sample.visible)).toBe(true);
      expect(new Set(blink.map((sample) => sample.stroke)).size).toBe(2);
      expect(blink.some((sample) => sample.stroke?.replaceAll(' ', '') === 'rgba(0,0,0,0)')).toBe(
        true,
      );
      const beforeZoom = await selection(page);
      expect(beforeZoom?.anchor?.height).toBeGreaterThan(0);
      const canvas = await page.getByLabel('Document canvas', { exact: true }).boundingBox();
      expect(canvas).not.toBeNull();
      await page.mouse.move(canvas!.x + 75, canvas!.y + 100);
      const wheel = async (delta: number) => {
        await page.keyboard.down('Control');
        try {
          await page.mouse.wheel(0, delta);
        } finally {
          await page.keyboard.up('Control');
        }
      };
      evidence.phase = 'ordinary-zoom';
      await wheel(-100);
      await expect
        .poll(
          async () =>
            (await selection(page))?.commands.findLast(
              (command) => command.id === 'doc.operation.set-zoom-ratio',
            )?.zoomRatio,
        )
        .toBe(1.14);
      const zoomed = await selection(page);
      if (!mobile) expect(zoomed!.scale.x).toBeGreaterThan(beforeZoom!.scale.x);
      else expect(zoomed!.scale).toEqual(beforeZoom!.scale);
      await wheel(100);
      await expect
        .poll(
          async () =>
            (await selection(page))?.commands.findLast(
              (command) => command.id === 'doc.operation.set-zoom-ratio',
            )?.zoomRatio,
        )
        .toBe(1);
      const restored = await selection(page);
      expect(restored!.scale).toEqual(beforeZoom!.scale);
      expect({ start: restored?.start, end: restored?.end }).toEqual({ start: 2086, end: 2086 });
      await exactText(page, expectedText);
      await saved(page);
      evidence.zoom = { before: beforeZoom, changed: zoomed, restored };
      evidence.heapBeforeDisposal = await cdp.send('Runtime.getHeapUsage');
      evidence.phase = 'ordinary-route-disposal';
      await page.getByRole('button', { name: 'Back to files', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Doc document', exact: true })).toHaveCount(0);
      expect(await selection(page)).toBeNull();
      expect(await readDocResponsiveness(page)).toBeNull();
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      await page.evaluate((name) => void performance.mark(name), DOC_CALLBACK_MARKERS.disposed);
      // This interval is an explicit observation window, not a readiness retry.
      await page.waitForTimeout(1200);
      await page.evaluate((name) => void performance.mark(name), DOC_CALLBACK_MARKERS.end);
      evidence.heapAfterDisposal = await cdp.send('Runtime.getHeapUsage');
      expect(f.errors).toEqual([]);
      evidence.behaviorPassed = true;
    } catch (error) {
      failure = error;
      evidence.error = String(error);
    } finally {
      try {
        if (finishInput) evidence.input = await finishInput();
        if (tracing) {
          tracing = false;
          const trace = await retainTrace(cdp, info.outputPath('spn113-trace.json'));
          evidence.trace = trace;
          const raw = JSON.parse(await readFile(info.outputPath(trace.file), 'utf8'));
          const attribution = await attributeDocCallbackSources({
            traceEvents: raw.traceEvents,
            origin: baseURL!,
            distDirectory: resolve('dist'),
          });
          const artifacts = [];
          await mkdir(info.outputPath('spn113-sources'), { recursive: true });
          for (const [index, artifact] of attribution.artifacts.entries()) {
            if (artifact.kind === 'docs-ui-source') {
              const file = `spn113-sources/${index}-docs-ui.js`;
              await writeFile(info.outputPath(file), artifact.content);
              artifacts.push({ ...artifact, content: undefined, sourceMapPath: undefined, file });
            } else {
              const file = `spn113-sources/${index}-${basename(artifact.path)}`;
              await copyFile(artifact.path, info.outputPath(file));
              artifacts.push({ ...artifact, path: undefined, file });
            }
          }
          evidence.attribution = { ...attribution, artifacts };
          const analysis = analyzeDocCallbackLifetimes({
            traceEvents: raw.traceEvents,
            completion: trace.completion as { dataLossOccurred: boolean },
            frameId,
            role: baseline ? 'baselineObservation' : 'candidate',
            callsites: attribution.callsites,
          });
          evidence.analysis = analysis;
          evidence.complete = analysis.complete;
          evidence.passed = evidence.behaviorPassed === true && analysis.accepted;
        }
      } catch (error) {
        failure ??= error;
        evidence.collectionError = String(error);
      } finally {
        evidence.errors = f.errors;
        await persist();
        await cdp.detach();
        await f.close();
      }
    }
    if (failure) throw failure;
    expect(evidence.passed, JSON.stringify(evidence.analysis)).toBe(true);
  });
