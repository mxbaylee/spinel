import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { NativeSnapshot } from '@spinel/sync-client';
import {
  canonical,
  inlineSnapshotCell,
  normalizedCell,
  normalizedDocBody,
  supportedMutationIds,
} from '@spinel/sync-transform';

interface Evidence {
  unitId: string;
  revision: number;
  snapshot: NativeSnapshot;
  observedAt: number;
  mutations: string[];
}
interface DeliveryTiming {
  unitId: string;
  expectedValues: [number, number];
  armedAt: number;
  keydownAt: number | null;
  firstObservedAt: number | null;
  firstObservedRevision: number | null;
  observations: number;
  peerKeydownAt: number | null;
  elapsedMs: number | null;
}
type RecordedWindow = Window & {
  nativeSyncEvidence?: Record<string, Evidence>;
  nativeSyncDelivery?: { timing: DeliveryTiming; stop(): void };
};
// One bounded record per page survives reloads for the fixture's final diagnostics.
const deliveryTimings = new WeakMap<Page, DeliveryTiming>();

export function nativeCellDeliveryTiming(page: Page) {
  return deliveryTimings.get(page);
}

const unsupportedSection =
  readFileSync(new URL('../lib/sync-transform/README.md', import.meta.url), 'utf8')
    .split('## Not supported\n')[1]
    ?.split('\n## ')[0] ?? '';
const classifiedMutations = new Set([
  ...supportedMutationIds,
  ...[...unsupportedSection.matchAll(/`([^`\s]+(?:\.mutation\.|\.operation\.)[^`\s]+)`/g)].map(
    (match) => match[1],
  ),
]);

export async function expectNativeMutationInventory(page: Page, unitId: string) {
  const read = () =>
    page.evaluate((id) => (window as RecordedWindow).nativeSyncEvidence?.[id]?.mutations, unitId);
  await expect.poll(async () => (await read())?.length ?? 0).toBeGreaterThan(0);
  const ids = (await read())!;
  expect(ids).toContain('doc.mutation.rich-text-editing');
  expect(
    ids.filter((id) => !classifiedMutations.has(id)),
    'Every actual loaded mutation must have a transform or an exact documented exclusion',
  ).toEqual([]);
}

/** The listener belongs to the test context; normal app builds emit no event. */
export async function recordNativeSnapshots(context: BrowserContext) {
  await context.addInitScript(() => {
    const records: Record<string, Evidence> = Object.create(null);
    (window as RecordedWindow).nativeSyncEvidence = records;
    window.addEventListener('spinel-sync-native-snapshot', (event) => {
      const value = (event as CustomEvent<Omit<Evidence, 'observedAt'>>).detail;
      records[value.unitId] = { ...structuredClone(value), observedAt: Date.now() };
    });
  });
}

/** Commit prepared edits and measure each peer from the sender's actual Enter event. */
export async function expectNativeCellDelivery(pages: readonly [Page, Page], unitId: string) {
  for (const page of pages) deliveryTimings.delete(page);
  try {
    const armed = await Promise.allSettled(
      pages.map((page) =>
        page.evaluate((id) => {
          const recorded = window as RecordedWindow;
          recorded.nativeSyncDelivery?.stop();
          const controller = new AbortController();
          const timing: DeliveryTiming = {
            unitId: id,
            expectedValues: [41, 73],
            armedAt: Date.now(),
            keydownAt: null,
            firstObservedAt: null,
            firstObservedRevision: null,
            observations: 0,
            peerKeydownAt: null,
            elapsedMs: null,
          };
          recorded.nativeSyncDelivery = { timing, stop: () => controller.abort() };
          window.addEventListener(
            'keydown',
            (event) => {
              if (event.key === 'Enter' && timing.keydownAt === null) timing.keydownAt = Date.now();
            },
            { capture: true, signal: controller.signal },
          );
          window.addEventListener(
            'spinel-sync-native-snapshot',
            (event) => {
              const observedAt = Date.now();
              const value = (event as CustomEvent<Omit<Evidence, 'observedAt'>>).detail;
              if (value.unitId !== id || !('sheets' in value.snapshot)) return;
              timing.observations++;
              const sheet = value.snapshot.sheets[value.snapshot.sheetOrder[0]];
              if (
                timing.firstObservedAt === null &&
                sheet.cellData?.[0]?.[0]?.v === timing.expectedValues[0] &&
                sheet.cellData?.[0]?.[1]?.v === timing.expectedValues[1]
              ) {
                timing.firstObservedAt = observedAt;
                timing.firstObservedRevision = value.revision;
              }
            },
            { capture: true, signal: controller.signal },
          );
        }, unitId),
      ),
    );
    for (const result of armed) if (result.status === 'rejected') throw result.reason;
    // Both capture listeners are armed before either Playwright input request.
    const committed = await Promise.allSettled(pages.map((page) => page.keyboard.press('Enter')));
    for (const result of committed) if (result.status === 'rejected') throw result.reason;
    const delivered = await Promise.allSettled(
      pages.map((page) =>
        expect
          .poll(
            () =>
              page.evaluate(
                () => (window as RecordedWindow).nativeSyncDelivery?.timing.firstObservedAt != null,
              ),
            { intervals: [10] },
          )
          .toBe(true),
      ),
    );
    for (const result of delivered) if (result.status === 'rejected') throw result.reason;
  } finally {
    // Preserve partial timing on failure, remove listeners, and keep evidence
    // outside the page so later reloads cannot erase a completed measurement.
    const observed = await Promise.allSettled(
      pages.map((page) =>
        page.evaluate(() => {
          const recorded = window as RecordedWindow;
          const delivery = recorded.nativeSyncDelivery;
          delivery?.stop();
          delete recorded.nativeSyncDelivery;
          return delivery?.timing;
        }),
      ),
    );
    for (const [index, result] of observed.entries())
      if (result.status === 'fulfilled' && result.value)
        deliveryTimings.set(pages[index], result.value);
    for (const [index, page] of pages.entries()) {
      const timing = deliveryTimings.get(page);
      const peer = deliveryTimings.get(pages[1 - index]);
      if (timing && peer) {
        timing.peerKeydownAt = peer.keydownAt;
        if (timing.firstObservedAt !== null && peer.keydownAt !== null)
          timing.elapsedMs = timing.firstObservedAt - peer.keydownAt;
      }
    }
  }
  for (const page of pages) {
    const timing = deliveryTimings.get(page);
    expect(timing?.armedAt).toBeGreaterThan(0);
    expect(timing?.keydownAt).toBeGreaterThan(0);
    expect(timing?.peerKeydownAt).toBeGreaterThan(0);
    expect(timing?.firstObservedAt).toBeGreaterThan(0);
    expect(timing?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(timing?.elapsedMs).toBeLessThan(1000);
  }
}

/** Only documented native defaults/style indirection and revision are normalized. */
function comparable(snapshot: NativeSnapshot) {
  if (!('sheets' in snapshot))
    return JSON.parse(
      canonical({ ...snapshot, rev: undefined, body: normalizedDocBody(snapshot.body) }),
    );
  const sheets = Object.fromEntries(
    Object.entries(snapshot.sheets).map(([sheetId, sheet]) => [
      sheetId,
      {
        ...sheet,
        cellData: Object.fromEntries(
          Object.entries(sheet.cellData ?? {})
            .map(([r, columns]) => [
              r,
              Object.fromEntries(
                Object.entries(columns ?? {}).flatMap(([c]) => {
                  const value = normalizedCell(
                    inlineSnapshotCell(snapshot, { sheetId, row: Number(r), column: Number(c) }),
                  );
                  return value ? [[c, value]] : [];
                }),
              ),
            ])
            .filter(([, row]) => Object.keys(row as object).length),
        ),
      },
    ]),
  );
  return JSON.parse(canonical({ ...snapshot, rev: undefined, styles: {}, sheets }));
}

export async function expectNativeSnapshots(
  pages: Page[],
  expected: { revision: number; snapshot: NativeSnapshot },
) {
  const native: NativeSnapshot[] = [];
  for (const page of pages) {
    const read = () =>
      page.evaluate(
        (id) => (window as RecordedWindow).nativeSyncEvidence?.[id],
        expected.snapshot.id,
      );
    await expect.poll(async () => (await read())?.revision).toBe(expected.revision);
    await expectNativeMutationInventory(page, expected.snapshot.id);
    native.push((await read())!.snapshot);
  }
  // Compare every native field, including all cells, metadata, drawings and resources.
  expect(comparable(native[0])).toEqual(comparable(native[1]));
  for (const snapshot of native)
    expect(comparable(snapshot)).toEqual(comparable(expected.snapshot));
}
