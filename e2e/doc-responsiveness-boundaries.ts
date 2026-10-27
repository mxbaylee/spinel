import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readDocResponsiveness } from './doc-responsiveness.ts';
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

async function compose(page: Page, phase: 'start' | 'update' | 'end', text: string) {
  await nativeInput(page).evaluate(
    (node, { phase, text }) => {
      if (phase === 'start') {
        node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        return;
      }
      node.textContent = text;
      const selection = window.getSelection();
      selection?.selectAllChildren(node);
      selection?.collapseToEnd();
      node.dispatchEvent(
        new CompositionEvent(phase === 'update' ? 'compositionupdate' : 'compositionend', {
          bubbles: true,
          data: text,
        }),
      );
      if (phase === 'update')
        node.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertCompositionText',
            data: text,
            isComposing: true,
          }),
        );
    },
    { phase, text },
  );
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
        let complete = false;
        await f.first.tracing.start({ screenshots: true, snapshots: true, sources: true });
        try {
          await Promise.all([
            f.page.goto(`/?item=${f.item.id}`),
            f.other.goto(`/?item=${f.item.id}`),
          ]);
          await Promise.all([saved(f.page), saved(f.other), online(f.page), online(f.other)]);
          await f.page.bringToFront();
          await focusEmptyDoc(f.page, mobile);
          const prefix = 'B'.repeat(64) + 'p'.repeat(63);
          await f.page.keyboard.type(prefix);
          const before = (await readDocResponsiveness(f.page))!;
          expect(before.pending).toEqual({ history: 63, collaboration: 63 });
          evidence.beforeCancellation = before;
          await compose(f.page, 'start', '');
          // More intermediate updates than the capacity limit must remain one
          // composition, never sixty-four separately undoable provisional strings.
          for (let update = 0; update < 70; update++)
            await compose(f.page, 'update', `仮${update}`);
          await exactText(f.page, prefix + '仮69\r\n');
          const intermediate = (await readDocResponsiveness(f.page))!;
          evidence.intermediate = intermediate;
          // The pre-composition typing may reach its normal 300 ms idle boundary.
          // No provisional IME update may add another native undo group.
          expect(intermediate.history.undos).toBeLessThanOrEqual(before.history.undos + 1);
          expect(intermediate.highWater.history).toBeLessThanOrEqual(64);
          expect(intermediate.highWater.collaboration).toBeLessThanOrEqual(64);
          await compose(f.page, 'end', '');
          await saved(f.page);
          await exactText(f.page, prefix + '\r\n');
          await exactText(f.other, prefix + '\r\n');
          expect((await f.read()).body!.dataStream).toBe(prefix + '\r\n');
          await expect
            .poll(async () => (await readDocResponsiveness(f.page))?.pending)
            .toEqual({ history: 0, collaboration: 0 });

          // Re-enter just below the capacity boundary, then finalize a multi-code-
          // point composition as the sixty-fourth completed change.
          const suffix = 'q'.repeat(63);
          await f.page.keyboard.type(suffix);
          expect((await readDocResponsiveness(f.page))?.pending).toEqual({
            history: 63,
            collaboration: 63,
          });
          await compose(f.page, 'start', '');
          await compose(f.page, 'update', 'か');
          await compose(f.page, 'update', 'かん');
          await compose(f.page, 'end', '漢字');
          const finalText = prefix + suffix + '漢字\r\n';
          await saved(f.page);
          await exactText(f.page, finalText);
          await exactText(f.other, finalText);
          expect((await readDocResponsiveness(f.page))?.selection).toMatchObject({
            start: finalText.length - 2,
            end: finalText.length - 2,
          });
          await f.page.keyboard.press('Control+z');
          await saved(f.page);
          await exactText(f.page, prefix + '\r\n');
          await exactText(f.other, prefix + '\r\n');
          expect((await readDocResponsiveness(f.page))?.selection).toMatchObject({
            start: prefix.length,
            end: prefix.length,
          });
          await f.page.keyboard.press('Control+Shift+z');
          await saved(f.page);
          await exactText(f.page, finalText);
          await exactText(f.other, finalText);
          expect((await f.read()).body!.dataStream).toBe(finalText);
          expect(f.errors).toEqual([]);
          evidence.final = await readDocResponsiveness(f.page);
          evidence.correctness =
            'cancelled provisional text absent; finalized composition atomically undone/redone with exact saved and peer text';
          complete = true;
        } finally {
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
        guest.on('pageerror', (error) => f.errors.push(error.message));
        let release = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let held = 0;
        const forwarded: boolean[] = [];
        const evidence: Record<string, unknown> = { preset, physicalIme: false };
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
          await guest.bringToFront();
          await focusEmptyDoc(guest, mobile);
          const original = await f.first.request.get(`/api/items/${f.item.id}/doc`);
          const before = await original.json();
          network.interceptWrites(async (write) => {
            held++;
            await gate;
            forwarded.push(write.forward());
          });
          await guest.keyboard.type('g'.repeat(127));
          await expect.poll(() => held).toBe(1);
          const native = (await readDocResponsiveness(guest))!;
          expect(native.pending).toEqual({ history: 63, collaboration: 63 });
          expect(native.flushes.length).toBeGreaterThan(0);
          await compose(guest, 'start', '');
          await compose(guest, 'update', '保留');
          await exactText(guest, 'g'.repeat(127) + '保留\r\n');
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
          evidence.correctness =
            'pending and late guest edits refused; persisted snapshot/revision unchanged; old capability denied';
          evidence.heldWrites = held;
          evidence.forwardedAfterRevocation = forwarded;
          complete = true;
        } finally {
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
