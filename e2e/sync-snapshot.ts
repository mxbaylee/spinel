import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { NativeSnapshot } from '@spinel/sync-client';
import {
  canonical,
  inlineSnapshotCell,
  normalizedCell,
  normalizedDocBody,
} from '@spinel/sync-transform';

interface Evidence {
  unitId: string;
  revision: number;
  snapshot: NativeSnapshot;
}
type RecordedWindow = Window & { nativeSyncEvidence?: Record<string, Evidence> };

/** The listener belongs to the test context; normal app builds emit no event. */
export async function recordNativeSnapshots(context: BrowserContext) {
  await context.addInitScript(() => {
    const records: Record<string, Evidence> = Object.create(null);
    (window as RecordedWindow).nativeSyncEvidence = records;
    window.addEventListener('spinel-sync-native-snapshot', (event) => {
      const value = (event as CustomEvent<Evidence>).detail;
      records[value.unitId] = structuredClone(value);
    });
  });
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
    native.push((await read())!.snapshot);
  }
  // Compare every native field, including all cells, metadata, drawings and resources.
  expect(comparable(native[0])).toEqual(comparable(native[1]));
  for (const snapshot of native)
    expect(comparable(snapshot)).toEqual(comparable(expected.snapshot));
}
