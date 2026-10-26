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
type RecordedWindow = Window & { nativeSyncEvidence?: Record<string, Evidence> };

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

/** Measure native delivery itself; clipboard/selection automation is separate proof. */
export async function expectNativeCellDelivery(pages: Page[], unitId: string, started: number) {
  await Promise.all(
    pages.map(async (page) => {
      const read = () =>
        page.evaluate((id) => {
          const evidence = (window as RecordedWindow).nativeSyncEvidence?.[id];
          if (!evidence || !('sheets' in evidence.snapshot)) return null;
          const sheet = evidence.snapshot.sheets[evidence.snapshot.sheetOrder[0]];
          return {
            values: [sheet.cellData?.[0]?.[0]?.v, sheet.cellData?.[0]?.[1]?.v],
            observedAt: evidence.observedAt,
          };
        }, unitId);
      await expect.poll(async () => (await read())?.values, { intervals: [10] }).toEqual([41, 73]);
      expect((await read())!.observedAt - started).toBeLessThan(1000);
    }),
  );
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
