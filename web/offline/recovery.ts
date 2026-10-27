import { NativeReplica, SyncClient, validateRecoverySnapshot } from '@spinel/sync-client';
import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import { validateFormulaDefinition } from '@spinel/doc-formulas';
import type { OfflineBundle } from '../../src/shared/offlineBundle.ts';
import { mapNativeImageSources } from '../../src/shared/nativeImageSources.ts';
import { snapshotIdentity } from '../../src/shared/snapshotIdentity.ts';
import { verifyImages } from './PreparedImages.ts';

/** Use the same checkpoint admission and native handlers as normal reopening. */
export function reconstructOffline(checkpoint: ClientCheckpoint, kind: 'sheet' | 'doc') {
  validateRecoverySnapshot(checkpoint);
  if (checkpoint.recoveryMissing)
    throw new Error('The latest visible changes are not saved. Keep this tab open and retry saving.');
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
  return mapNativeImageSources(snapshot, (source) => {
    const image = sources.get(source);
    if (!image) throw new Error('An offline image is missing. Keep this device copy until it can be recovered.');
    return image;
  }, { updateSourceType: true });
}

export function offlineCopyName(title: string, at = new Date()) {
  const suffix = ` (offline copy, ${at.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })})`;
  return title.slice(0, Math.max(1, 200 - suffix.length)) + suffix;
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
