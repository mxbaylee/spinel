import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { DOC_RESPONSIVENESS_GROUP_LIMIT, readDocResponsiveness } from './doc-responsiveness.ts';
import {
  fixture,
  focusEmptyDoc,
  exactText,
  nativeInput,
  saved,
  online,
} from './doc-responsiveness-fixture.ts';
import { syncNetwork } from './sync-network.ts';

// These exercise the native browser controller. They do not claim physical OS
// keyboard/IME coverage. First-attempt failures remain failures.

async function compose(session: CDPSession, phase: 'update' | 'end', text: string) {
  // Drive Chromium's input pipeline: the first update starts composition, and
  // commit generates the final update/input before its matching compositionend.
  // This is browser-generated input, without physical OS IME coverage.
  if (phase === 'end' && text) await session.send('Input.insertText', { text });
  else
    await session.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
}

async function recordCompositionEvents(page: Page) {
  const observation = await page.evaluateHandle(() => {
    const types = [
      'compositionstart',
      'compositionupdate',
      'compositionend',
      'beforeinput',
      'input',
    ];
    const events: Array<{
      order: number;
      phase: string;
      type: string;
      data: string | null;
      inputType: string | null;
      isComposing: boolean | null;
      isTrusted: boolean;
      observedAt: number;
    }> = [];
    let phase = '';
    let dropped = 0;
    const record = (event: Event) => {
      if (
        !phase ||
        !(event.target instanceof Element) ||
        !event.target.matches('[contenteditable="true"][data-u-comp="editor"]')
      )
        return;
      if (events.length >= 512) {
        dropped++;
        return;
      }
      events.push({
        order: events.length,
        phase,
        type: event.type,
        data: (event as CompositionEvent | InputEvent).data,
        inputType: event instanceof InputEvent ? event.inputType : null,
        isComposing: event instanceof InputEvent ? event.isComposing : null,
        isTrusted: event.isTrusted,
        observedAt: performance.now(),
      });
    };
    for (const type of types) document.addEventListener(type, record, true);
    return {
      phase(value: string) {
        phase = value;
      },
      read() {
        return { events, dropped };
      },
      finish() {
        for (const type of types) document.removeEventListener(type, record, true);
        return { events, dropped };
      },
    };
  });
  return {
    phase: (phase: string) => observation.evaluate((value, phase) => value.phase(phase), phase),
    read: () => observation.evaluate((value) => value.read()),
    async finish() {
      try {
        return await observation.evaluate((value) => value.finish());
      } finally {
        await observation.dispose();
      }
    },
  };
}

function expectCompositionEnd(
  events: Array<{ phase: string; type: string; data: string | null; order: number }>,
  phase: string,
  text: string,
) {
  let previousOrder = -1;
  for (const expected of [
    { type: 'compositionupdate', data: text },
    { type: 'beforeinput', data: text },
    // Chromium's cancellation input reports the removed provisional text.
    // Its data is intentionally unconstrained; the empty update/end are exact.
    { type: 'input', ...(text ? { data: text } : {}) },
    { type: 'compositionend', data: text },
  ]) {
    const event = events.find(
      (event) =>
        event.phase === phase &&
        event.order > previousOrder &&
        event.type === expected.type &&
        (!('data' in expected) || event.data === expected.data),
    );
    expect(event, `${phase}: observed ${expected.type} after order ${previousOrder}`).toBeDefined();
    previousOrder = event!.order;
  }
}

export function registerDocResponsivenessBoundaries() {
  test.describe('native boundary checks', () => {
    test.describe.configure({ retries: 0 });
    for (const preset of ['desktop', 'mobile'] as const) {
      test(`${preset} pending composition crosses the group limit without partial history`, async ({
        browser,
        baseURL,
      }, info) => {
        test.setTimeout(120_000);
        const mobile = preset === 'mobile';
        const f = await fixture(browser, baseURL!, info, mobile);
        const evidence: Record<string, unknown> = { preset, physicalIme: false };
        // Establish the session before near-limit typing so setup cannot consume
        // the native 300 ms idle interval we are testing.
        const composition = await f.first.newCDPSession(f.page);
        evidence.browser = await composition.send('Browser.getVersion');
        let inputEvents: Awaited<ReturnType<typeof recordCompositionEvents>> | undefined;
        let complete = false;
        await f.first.tracing.start({ screenshots: true, snapshots: true, sources: true });
        try {
          await Promise.all([
            f.page.goto(`/?item=${f.item.id}`),
            f.other.goto(`/?item=${f.item.id}`),
          ]);
          await Promise.all([saved(f.page), saved(f.other), online(f.page), online(f.other)]);
          inputEvents = await recordCompositionEvents(f.page);
          await f.page.bringToFront();
          await focusEmptyDoc(f.page, mobile);
          const limit = DOC_RESPONSIVENESS_GROUP_LIMIT;
          const pending = limit - 1;
          const prefix = 'B'.repeat(limit) + 'p'.repeat(pending);
          await f.page.keyboard.type(prefix);
          const before = (await readDocResponsiveness(f.page))!;
          expect(before.pending).toEqual({ history: pending, collaboration: pending });
          evidence.beforeCancellation = before;
          // More intermediate updates than the capacity limit must remain one
          // composition, never separately undoable provisional strings.
          const updates = 70;
          await inputEvents.phase('cancellation-updates');
          for (let update = 0; update < updates; update++)
            await compose(composition, 'update', `仮${update}`);
          const provisional = prefix + `仮${updates - 1}\r\n`;
          await exactText(f.page, provisional);
          const intermediate = (await readDocResponsiveness(f.page))!;
          evidence.intermediate = intermediate;
          // The pre-composition typing may reach its normal 300 ms idle boundary.
          // No provisional IME update may add another native undo group.
          expect(intermediate.history.undos).toBeLessThanOrEqual(before.history.undos + 1);
          expect(intermediate.highWater.history).toBeLessThanOrEqual(limit);
          expect(intermediate.highWater.collaboration).toBeLessThanOrEqual(limit);
          // Let only the preceding completed typing reach its native idle
          // boundary, so an unrelated timer cannot mask an Enter history change.
          // The provisional composition remains mounted and active throughout.
          await expect
            .poll(async () => (await readDocResponsiveness(f.page))?.pending)
            .toEqual({ history: 0, collaboration: 0 });
          const beforeEnter = (await readDocResponsiveness(f.page, true))!;
          expect(beforeEnter.text).toBe(provisional);
          await inputEvents.phase('composing-enter');
          await nativeInput(f.page).dispatchEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            isComposing: true,
          });
          await exactText(f.page, provisional);
          const afterEnter = (await readDocResponsiveness(f.page, true))!;
          expect(afterEnter.text).toBe(beforeEnter.text);
          expect(afterEnter.history).toEqual(beforeEnter.history);
          expect(afterEnter.pending).toEqual(beforeEnter.pending);
          expect(afterEnter.selection).toEqual(beforeEnter.selection);
          evidence.composingEnter = { before: beforeEnter, after: afterEnter };
          await inputEvents.phase('cancellation-end');
          await compose(composition, 'end', '');
          await inputEvents.phase('');
          await saved(f.page);
          await exactText(f.page, prefix + '\r\n');
          await exactText(f.other, prefix + '\r\n');
          expect((await f.read()).body!.dataStream).toBe(prefix + '\r\n');
          await expect
            .poll(async () => (await readDocResponsiveness(f.page))?.pending)
            .toEqual({ history: 0, collaboration: 0 });

          // Re-enter just below the capacity boundary, then finalize a multi-code-
          // point composition as the completed change that reaches the limit.
          const suffix = 'q'.repeat(pending);
          await f.page.keyboard.type(suffix);
          const beforeFinalComposition = (await readDocResponsiveness(f.page))!;
          expect(beforeFinalComposition.pending).toEqual({
            history: pending,
            collaboration: pending,
          });
          evidence.beforeFinalComposition = beforeFinalComposition;
          await inputEvents.phase('converted-updates');
          await compose(composition, 'update', 'か');
          await compose(composition, 'update', 'かん');
          await inputEvents.phase('converted-commit');
          await compose(composition, 'end', '漢字');
          const finalText = prefix + suffix + '漢字\r\n';
          await saved(f.page);
          await exactText(f.page, finalText);
          await exactText(f.other, finalText);
          const afterFinalComposition = (await readDocResponsiveness(f.page))!;
          evidence.afterFinalComposition = afterFinalComposition;
          expect(afterFinalComposition.selection).toMatchObject({
            start: finalText.length - 2,
            end: finalText.length - 2,
          });
          await inputEvents.phase('history-replay');
          await f.page.keyboard.press('Control+z');
          await saved(f.page);
          await exactText(f.page, prefix + '\r\n');
          await exactText(f.other, prefix + '\r\n');
          expect((await readDocResponsiveness(f.page))?.selection).toMatchObject({
            start: prefix.length,
            end: prefix.length,
          });
          // Use the pinned full-document non-Mac redo binding, as in the benchmark.
          await f.page.keyboard.press('Control+y');
          await saved(f.page);
          await exactText(f.page, finalText);
          await exactText(f.other, finalText);
          expect((await f.read()).body!.dataStream).toBe(finalText);
          expect(f.errors).toEqual([]);
          const delivered = await inputEvents.read();
          expect(delivered.dropped).toBe(0);
          expect(
            delivered.events
              .filter(
                (event) =>
                  event.phase === 'cancellation-updates' && event.type === 'compositionupdate',
              )
              .map((event) => event.data),
          ).toEqual(Array.from({ length: updates }, (_, index) => `仮${index}`));
          expectCompositionEnd(delivered.events, 'cancellation-end', '');
          expectCompositionEnd(delivered.events, 'converted-commit', '漢字');
          evidence.final = await readDocResponsiveness(f.page);
          evidence.correctness =
            'composing Enter preserves provisional text and history; cancelled provisional text absent; finalized composition atomically undone/redone with exact saved and peer text';
          complete = true;
        } finally {
          if (inputEvents) evidence.compositionEvents = await inputEvents.finish();
          await composition.detach();
          await f.first.tracing.stop(complete ? {} : { path: info.outputPath('trace.zip') });
          evidence.errors = f.errors;
          await writeFile(
            info.outputPath('spn108-boundaries.json'),
            JSON.stringify(evidence, null, 2),
          );
          await f.close();
        }
      });

      test(`${preset} revocation refuses pending guest input and a late composition event`, async ({
        browser,
        baseURL,
      }, info) => {
        test.setTimeout(120_000);
        const mobile = preset === 'mobile';
        const f = await fixture(browser, baseURL!, info, mobile);
        const guestContext = await f.account();
        const network = await syncNetwork(guestContext);
        const guest = await guestContext.newPage();
        const composition = await guestContext.newCDPSession(guest);
        let inputEvents: Awaited<ReturnType<typeof recordCompositionEvents>> | undefined;
        guest.on('pageerror', (error) => f.errors.push(error.message));
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let held = 0;
        const forwarded: boolean[] = [];
        const evidence: Record<string, unknown> = { preset, physicalIme: false };
        evidence.browser = await composition.send('Browser.getVersion');
        let complete = false;
        await guestContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
        try {
          await f.page.goto(`/?item=${f.item.id}`);
          await saved(f.page);
          const link = await f.first.request.put(`/api/items/${f.item.id}/link`, {
            headers: { Origin: baseURL! },
            data: { role: 'editor' },
          });
          expect(link.ok()).toBe(true);
          await guest.goto((await link.json()).url);
          await saved(guest);
          await online(guest);
          inputEvents = await recordCompositionEvents(guest);
          await guest.bringToFront();
          await focusEmptyDoc(guest, mobile);
          const original = await f.first.request.get(`/api/items/${f.item.id}/doc`);
          const before = await original.json();
          network.interceptWrites(async (write) => {
            held++;
            await gate;
            forwarded.push(write.forward());
          });
          const limit = DOC_RESPONSIVENESS_GROUP_LIMIT;
          const prefix = 'g'.repeat(2 * limit - 1);
          await guest.keyboard.type(prefix);
          await expect.poll(() => held).toBe(1);
          const native = (await readDocResponsiveness(guest))!;
          expect(native.pending).toEqual({ history: limit - 1, collaboration: limit - 1 });
          expect(native.flushes.length).toBeGreaterThan(0);
          await inputEvents.phase('guest-provisional');
          await compose(composition, 'update', '保留');
          await exactText(guest, prefix + '保留\r\n');
          const input = (await nativeInput(guest).elementHandle())!;
          const submissions = network.outgoing.filter((frame) => frame.type === 'submit').length;
          evidence.pendingBeforeRevocation = await readDocResponsiveness(guest);
          const revoked = await f.first.request.put(`/api/items/${f.item.id}/link`, {
            headers: { Origin: baseURL! },
            data: { role: null },
          });
          expect(revoked.ok()).toBe(true);
          await expect(
            guest.getByRole('region', { name: 'Doc document', exact: true }),
          ).toHaveCount(0, { timeout: 10_000 });
          await expect(
            guest.getByText('This link no longer works.', { exact: true }),
          ).toBeVisible();
          release();
          await network.drainWrites();
          expect(forwarded).toEqual([false]);
          // A late event still referring to the disposed browser input cannot
          // resurrect the editor, queue work, or use its old guest capability.
          await inputEvents.phase('revoked-detached-event');
          await input.evaluate((node) => {
            node.dispatchEvent(
              new CompositionEvent('compositionend', { bubbles: true, data: '確定' }),
            );
          });
          await guest.keyboard.type('forbidden after revocation');
          await guest.keyboard.press('Enter');
          expect(network.outgoing.filter((frame) => frame.type === 'submit')).toHaveLength(
            submissions,
          );
          const denied = await guestContext.request.post(
            `/sync-api/guest/${f.item.id}/ticket?unitId=${encodeURIComponent(native.unitId)}`,
            {
              headers: { Origin: baseURL! },
              data: {},
            },
          );
          expect(denied.status()).toBe(403);
          const after = await f.first.request.get(`/api/items/${f.item.id}/doc`);
          expect(await after.json()).toEqual(before);
          await exactText(f.page, '\r\n');
          expect(f.errors).toEqual([]);
          expect((await inputEvents.read()).dropped).toBe(0);
          evidence.correctness =
            'pending and late guest edits refused; persisted snapshot/revision unchanged; old capability denied';
          evidence.heldWrites = held;
          evidence.forwardedAfterRevocation = forwarded;
          complete = true;
        } finally {
          if (inputEvents) evidence.compositionEvents = await inputEvents.finish();
          await composition.detach();
          await guestContext.tracing.stop(complete ? {} : { path: info.outputPath('trace.zip') });
          release();
          await network.drainWrites();
          evidence.errors = f.errors;
          await writeFile(
            info.outputPath('spn108-boundaries.json'),
            JSON.stringify(evidence, null, 2),
          );
          await f.close();
        }
      });
    }
  });
}
