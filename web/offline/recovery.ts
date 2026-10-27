import { NativeReplica, SyncClient, validateRecoverySnapshot } from '@spinel/sync-client';
import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import { validateFormulaDefinition } from '@spinel/doc-formulas';
import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';
import type { OfflineRecoveryRequest } from '../../src/shared/offlineRecovery.ts';
import { mapNativeImageSources } from '../../src/shared/nativeImageSources.ts';
import { snapshotIdentity } from '../../src/shared/snapshotIdentity.ts';
import { verifyImages } from './PreparedImages.ts';

/** Use the same checkpoint admission and native handlers as normal reopening. */
export function reconstructOffline(checkpoint: ClientCheckpoint, kind: 'sheet' | 'doc') {
  validateRecoverySnapshot(checkpoint);
  if (checkpoint.recoveryMissing)
    throw new Error(
      'The latest visible changes are not saved. Keep this tab open and retry saving.',
    );
  const replica = new NativeReplica(checkpoint.snapshot, kind);
  let client: SyncClient | undefined;
  try {
    client = new SyncClient({
      unitId: checkpoint.unitId,
      revision: checkpoint.revision,
      confirmed: replica,
      checkpoint,
      applyRemote() {},
      visibleSnapshot: () => replica.snapshot(),
      send() {},
      onState() {},
      onResync() {},
    });
    const retained = client.checkpoint();
    if (retained.recoverySnapshot) return structuredClone(retained.recoverySnapshot);
    // sent is a retry identity, not another copy of the transformed inflight edits.
    replica.apply([...retained.inflight, ...retained.buffer.flat()]);
    return replica.snapshot();
  } finally {
    if (client) client.dispose();
    else replica.dispose();
  }
}

/** Definitions may travel; evaluated private values may never enter an export. */
function validateFormulas(snapshot: NativeSnapshot) {
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 1_000_000 || depth > 64)
      throw new Error('This offline document is too complex to export safely.');
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.customRanges))
      for (const range of record.customRanges) {
        const properties = range?.properties;
        if (properties && Object.hasOwn(properties, 'spinelFormula'))
          properties.spinelFormula = validateFormulaDefinition(properties.spinelFormula);
      }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(snapshot, 0);
}

/** No network fallback: only the original item's verified bytes become data URLs. */
export async function portableOfflineSnapshot(
  bundle: OfflineBundle,
  checkpoint: ClientCheckpoint,
  bytes: ReadonlyMap<string, Uint8Array>,
  verify: () => void,
) {
  verify();
  const snapshot = snapshotIdentity(reconstructOffline(checkpoint, bundle.kind), bundle.itemId);
  validateFormulas(snapshot);
  const images = await verifyImages(bundle.itemId, bundle.images, bytes, verify);
  const sources = new Map<string, string>();
  for (const [source, blob] of images) {
    const data = new Uint8Array(await blob.arrayBuffer());
    verify();
    const parts: string[] = [];
    for (let at = 0; at < data.length; at += 0x8000)
      parts.push(String.fromCharCode(...data.subarray(at, at + 0x8000)));
    sources.set(source, `data:${blob.type};base64,${btoa(parts.join(''))}`);
  }
  return mapNativeImageSources(
    snapshot,
    (source) => {
      const image = sources.get(source);
      if (!image)
        throw new Error(
          'An offline image is missing. Keep this device copy until it can be recovered.',
        );
      return image;
    },
    { updateSourceType: true },
  );
}

const titlePrefix = (title: string, suffix: string) =>
  title.slice(0, 120 - suffix.length).replace(/[\uD800-\uDBFF]$/, '');

export function offlineCopyName(title: string, at = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  // Local clock, with no locale-dependent slashes or control characters in a filename.
  const local = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const suffix = ` (offline copy, ${local})`;
  return titlePrefix(title, suffix) + suffix;
}

const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, child) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(
          Object.keys(child)
            .sort()
            .map((key) => [key, child[key]]),
        )
      : child,
  );

/** Native replay allocates fresh style IDs; their values and uses must still agree. */
function comparableRecoverySnapshot(snapshot: NativeSnapshot, checkpoint: ClientCheckpoint) {
  if (!('sheets' in snapshot)) return canonical(snapshot);
  const copy = structuredClone(snapshot);
  const object = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (!object(copy.styles) || !object(copy.sheets)) return canonical(copy);
  const source = checkpoint.recoverySnapshot ?? checkpoint.snapshot;
  const retained = 'sheets' in source && object(source.styles) ? source.styles : {};
  const generated = new Map(
    Object.entries(copy.styles)
      .filter(([id]) => !Object.hasOwn(retained, id))
      .map(([id, style]) => [id, canonical(style)]),
  );
  // Keep unused styles and duplicate definitions, and index values instead of
  // expanding a large shared style into every cell. Existing IDs stay exact.
  const values = [...generated.values()].sort();
  const indexes = new Map(values.map((value, index) => [value, index]));
  const styleSlot = (value: unknown, key: string) => {
    if (!object(value) || !Object.hasOwn(value, key)) return;
    const style = value[key];
    value[key] =
      typeof style === 'string' && generated.has(style)
        ? { generated: indexes.get(generated.get(style)!) }
        : { retained: style };
  };
  // Only these native slots refer to workbook styles. Opaque custom data,
  // resources, rich text and every authored style property remain untouched.
  styleSlot(copy, 'defaultStyle');
  for (const sheet of Object.values(copy.sheets)) {
    if (!object(sheet)) continue;
    styleSlot(sheet, 'defaultStyle');
    for (const data of [sheet.rowData, sheet.columnData])
      for (const entry of Object.values(data ?? {})) styleSlot(entry, 's');
    for (const row of Object.values(sheet.cellData ?? {}))
      for (const cell of Object.values(row ?? {})) styleSlot(cell, 's');
  }
  for (const id of generated.keys()) delete copy.styles[id];
  return canonical({ snapshot: copy, generatedStyles: values });
}

/** A stored retry request never outranks the native checkpoint and verified bytes. */
export function verifyRecoveryRequest(
  bundle: OfflineBundle,
  checkpoint: ClientCheckpoint,
  recovery: OfflineRecoveryRequest,
  rebuilt: NativeSnapshot,
) {
  const mismatch = () =>
    new Error(
      'The saved recovery request does not match your offline changes. Keep this device copy.',
    );
  if (
    !recovery ||
    typeof recovery !== 'object' ||
    Object.keys(recovery).sort().join(',') !== 'filename,possibleReplayCrash,recoveryId,snapshot' ||
    typeof recovery.recoveryId !== 'string' ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(recovery.recoveryId) ||
    recovery.possibleReplayCrash !== Boolean(checkpoint.sent) ||
    !recovery.snapshot ||
    typeof recovery.snapshot !== 'object'
  )
    throw mismatch();
  const name = 'sheets' in recovery.snapshot ? recovery.snapshot.name : recovery.snapshot.title;
  if (typeof name !== 'string') throw mismatch();
  const suffix = name.match(/ \(offline copy, \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/)?.[0];
  if (
    !suffix ||
    name !== titlePrefix(bundle.name, suffix) + suffix ||
    recovery.filename !== `${name}.univer.json`
  )
    throw mismatch();
  const expected = structuredClone(rebuilt);
  if ('sheets' in expected) expected.name = name;
  else expected.title = name;
  if (
    comparableRecoverySnapshot(expected, checkpoint) !==
    comparableRecoverySnapshot(recovery.snapshot, checkpoint)
  )
    throw mismatch();
}

export function downloadOfflineFile(snapshot: NativeSnapshot, filename: string) {
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
