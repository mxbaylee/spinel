import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { materialize, validateSnapshot, MAX_SNAPSHOT_BYTES } from '@spinel/sync-server';
import type { NativeSnapshot, DocumentKind } from '@spinel/sync-server';
import { validateFormulaDefinition } from '@spinel/doc-formulas';
import type { DatabaseSync } from '../../../server/database.ts';
import { imageSources } from '../workspace/imageSources.ts';
import { readSpaceStructure } from '../workspace/space-structure.ts';

type Item = {
  id: string;
  owner_id: string;
  parent_id: string | null;
  kind: string;
  space_id?: string | null;
  space_position?: number | null;
  trashed_at: number | null;
  trash_batch: string | null;
};
const invalid = () => new Error('Recovered application invariants failed.');
const exists = (db: DatabaseSync, table: string) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));

/** Runs only against an authenticated disposable copy. It creates no services,
 * credentials, listeners or schedules. Native materialization disables formula
 * execution; the worker also has no network permission. */
export async function verifySemantics(db: DatabaseSync) {
  for (const table of [
    'auth_users',
    'workspace_items',
    'workspace_grants',
    'workspace_links',
    'workspace_guest_sessions',
    'sheet_snapshots',
    'doc_snapshots',
    'doc_images',
  ])
    if (!exists(db, table)) throw invalid();
  db.exec('PRAGMA query_only=ON');
  const hasTransition = exists(db, 'spinel_sync_transition_state');
  if (hasTransition || exists(db, 'spinel_sync_transition_units')) {
    if (!hasTransition || !exists(db, 'spinel_sync_transition_units')) throw invalid();
    const transition = db.prepare('SELECT * FROM spinel_sync_transition_state WHERE id=1').get();
    if (
      transition?.status !== 'complete' ||
      !/^[a-f0-9]{64}$/.test(String(transition.source_hash)) ||
      !/^[a-f0-9]{64}$/.test(String(transition.manifest_hash))
    )
      throw invalid();
    // Receipts intentionally outlive purged/replaced generations. They establish
    // an authenticated initial native revision only after a completed cutover.
    for (const receipt of db.iterate('SELECT * FROM spinel_sync_transition_units'))
      if (
        typeof receipt.unit_id !== 'string' ||
        !receipt.unit_id ||
        !Number.isSafeInteger(receipt.revision) ||
        Number(receipt.revision) < 1 ||
        Number(receipt.revision) >= Number.MAX_SAFE_INTEGER ||
        !/^[a-f0-9]{64}$/.test(String(receipt.snapshot_hash))
      )
        throw invalid();
  }
  const rows = db.prepare('SELECT * FROM workspace_items LIMIT 100001').all() as unknown as Item[];
  if (rows.length > 100_000) throw new Error('Recovery exceeds the item verification budget.');
  const items = new Map(rows.map((item) => [item.id, item]));
  const accounts = new Map(
    [...db.iterate('SELECT id,is_admin,disabled FROM auth_users')].map((user) => [
      String(user.id),
      user,
    ]),
  );
  const visited = new Set<string>();
  for (const item of rows) {
    if (
      !accounts.has(item.owner_id) ||
      accounts.get(item.owner_id)!.is_admin !== 0 ||
      !['folder', 'space', 'doc', 'sheet'].includes(item.kind) ||
      (item.trashed_at === null) !== (item.trash_batch === null)
    )
      throw invalid();
    if (item.space_id != null) {
      const space = items.get(item.space_id);
      if (
        !space ||
        space.kind !== 'space' ||
        space.space_id != null ||
        space.owner_id !== item.owner_id ||
        item.kind === 'space'
      )
        throw invalid();
      continue; // The complete internal tree/recovery batches are checked below.
    }
    if (item.space_position != null) throw invalid();
    const path: Item[] = [];
    const active = new Set<string>();
    let cursor: Item | undefined = item;
    while (cursor && !visited.has(cursor.id)) {
      if (active.has(cursor.id)) throw invalid();
      active.add(cursor.id);
      path.push(cursor);
      if (cursor.parent_id === null) break;
      const parent = items.get(cursor.parent_id);
      if (
        !parent ||
        parent.kind !== 'folder' ||
        parent.space_id != null ||
        parent.owner_id !== cursor.owner_id
      )
        throw invalid();
      cursor = parent;
    }
    for (const value of path) visited.add(value.id);
    if (item.kind === 'space') {
      if (!exists(db, 'workspace_space_trash')) throw invalid();
      readSpaceStructure(db, item.id, item.owner_id);
    }
  }
  for (const grant of db.iterate('SELECT item_id,user_id,role FROM workspace_grants')) {
    const item = items.get(String(grant.item_id));
    if (
      !item ||
      item.space_id != null ||
      accounts.get(String(grant.user_id))?.is_admin !== 0 ||
      !['viewer', 'editor', 'admin'].includes(String(grant.role))
    )
      throw invalid();
  }
  if (
    exists(db, 'auth_sessions') &&
    exists(db, 'auth_passkeys') &&
    db
      .prepare(
        `SELECT 1 FROM auth_sessions s JOIN auth_passkeys p ON p.id=s.passkey_id
     WHERE s.user_id IS NOT p.user_id LIMIT 1`,
      )
      .get()
  )
    throw invalid();
  for (const link of db.iterate('SELECT * FROM workspace_links')) {
    const item = items.get(String(link.item_id));
    if (
      !item ||
      item.space_id != null ||
      !['doc', 'sheet', 'space'].includes(item.kind) ||
      !Number.isSafeInteger(link.epoch) ||
      Number(link.epoch) < 0 ||
      !['off', 'pending', 'active'].includes(String(link.state)) ||
      !['viewer', 'editor'].includes(String(link.role)) ||
      (link.state === 'active' &&
        (typeof link.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(link.token_hash)))
    )
      throw invalid();
  }
  let images = 0;
  for (const image of db.iterate('SELECT item_id,id,mime,data FROM doc_images')) {
    const item = items.get(String(image.item_id));
    if (
      !item ||
      !['doc', 'sheet'].includes(item.kind) ||
      !(image.data instanceof Uint8Array) ||
      !image.data.byteLength ||
      image.data.byteLength > 5 * 1024 ** 2 ||
      createHash('sha256').update(image.data).digest('hex') !== image.id ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(String(image.mime))
    )
      throw invalid();
    const decoder = sharp(image.data, { limitInputPixels: 16_000_000, failOn: 'error' });
    const metadata = await decoder.metadata();
    if (`image/${metadata.format}` !== image.mime || (metadata.pages ?? 1) > 1) throw invalid();
    await decoder.stats(); // Decode, not just header sniffing; discard all pixels.
    images++;
  }
  let snapshots = 0;
  const content = (
    itemId: string,
    text: string,
    kind: DocumentKind,
    unitId: string,
    native: boolean,
  ) => {
    if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) throw invalid();
    const snapshot = JSON.parse(text) as NativeSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.id !== unitId
    )
      throw invalid();
    if (native) {
      validateSnapshot(snapshot, kind, unitId);
      // A fresh headless OSS model exercises native loading/resource parsers.
      // Stored bytes remain unchanged and are independently inventory-verified.
      validateSnapshot(materialize(snapshot, kind), kind, unitId);
    } else if (kind === 'doc') {
      if (
        !('body' in snapshot) ||
        typeof snapshot.body?.dataStream !== 'string' ||
        !snapshot.body.dataStream.endsWith('\r\n')
      )
        throw invalid();
    } else {
      const book = snapshot as import('@univerjs/core').IWorkbookData;
      if (
        typeof book.name !== 'string' ||
        !Array.isArray(book.sheetOrder) ||
        !book.sheetOrder.length ||
        new Set(book.sheetOrder).size !== book.sheetOrder.length ||
        !book.sheets ||
        typeof book.sheets !== 'object' ||
        Array.isArray(book.sheets) ||
        book.sheetOrder.some((id) => typeof id !== 'string' || book.sheets[id]?.id !== id)
      )
        throw invalid();
    }
    let nodes = 0;
    const walk = (value: unknown, depth: number) => {
      if (++nodes > 200_000 || depth > 64) throw invalid();
      if (!value || typeof value !== 'object') return;
      for (const [key, value_] of Object.entries(value)) {
        if (key === 'spinelFormula') validateFormulaDefinition(value_);
        else walk(value_, depth + 1);
      }
    };
    walk(snapshot, 0);
    imageSources(snapshot, (source) => {
      const prefix = `/api/items/${itemId}/images/`;
      const id = source.slice(prefix.length);
      if (
        !source.startsWith(prefix) ||
        !/^[a-f0-9]{64}$/.test(id) ||
        !db.prepare('SELECT 1 FROM doc_images WHERE item_id=? AND id=?').get(itemId, id)
      )
        throw invalid();
      return source;
    });
    snapshots++;
  };
  for (const [table, kind] of [
    ['sheet_snapshots', 'sheet'],
    ['doc_snapshots', 'doc'],
  ] as const)
    for (const row of db.iterate(`SELECT item_id,snapshot,revision FROM ${table}`)) {
      const item = items.get(String(row.item_id));
      if (
        !item ||
        item.kind !== kind ||
        !Number.isSafeInteger(row.revision) ||
        Number(row.revision) < 0
      )
        throw invalid();
      content(item.id, String(row.snapshot), kind, item.id, false);
    }
  const activeUnits = new Map<string, Item>();
  for (const item of rows.filter((value) => ['doc', 'sheet'].includes(value.kind))) {
    const active = exists(db, 'spinel_live_units')
      ? db
          .prepare('SELECT unit_id,revision_offset FROM spinel_live_units WHERE item_id=?')
          .get(item.id)
      : undefined;
    if (
      active &&
      (!Number.isSafeInteger(active.revision_offset) || Number(active.revision_offset) < 0)
    )
      throw invalid();
    const unitId = String(active?.unit_id ?? item.id);
    if (activeUnits.has(unitId)) throw invalid();
    activeUnits.set(unitId, item);
    if (
      exists(db, 'workspace_collaboration') &&
      db
        .prepare("SELECT 1 FROM workspace_collaboration WHERE item_id=? AND state='ready'")
        .get(item.id) &&
      (!exists(db, 'spinel_sync_units') ||
        !db
          .prepare('SELECT 1 FROM spinel_sync_units WHERE unit_id=? AND kind=?')
          .get(unitId, item.kind))
    )
      throw invalid();
  }
  const stagedUnits = new Map<string, Item>();
  if (exists(db, 'spinel_restore_jobs'))
    for (const job of db.iterate("SELECT * FROM spinel_restore_jobs WHERE status='staging'")) {
      const item = items.get(String(job.item_id));
      if (
        !item ||
        activeUnits.get(String(job.previous_unit)) !== item ||
        typeof job.next_unit !== 'string' ||
        !job.next_unit ||
        activeUnits.has(job.next_unit) ||
        stagedUnits.has(job.next_unit) ||
        job.revision !== null
      )
        throw invalid();
      stagedUnits.set(job.next_unit, item);
    }
  if (exists(db, 'spinel_sync_units'))
    for (const unit of db.iterate('SELECT * FROM spinel_sync_units')) {
      let item = activeUnits.get(String(unit.unit_id));
      if (!item) {
        // A committed restore/deletion can leave an old unit for the purge outbox.
        if (
          exists(db, 'collaboration_purge') &&
          db.prepare('SELECT 1 FROM collaboration_purge WHERE item_id=?').get(unit.unit_id)
        )
          continue;
        // An online copy can also fall between creation of a staged generation
        // and its activation transaction. Validate it without completing the job;
        // the normal startup recovery will cancel this uncommitted replacement.
        item = stagedUnits.get(String(unit.unit_id));
        if (!item || unit.revision !== 1 || unit.retained_from !== 1) throw invalid();
      }
      if (
        item.kind !== unit.kind ||
        !Number.isSafeInteger(unit.revision) ||
        Number(unit.revision) < 1 ||
        !Number.isSafeInteger(unit.retained_from) ||
        Number(unit.retained_from) < 1 ||
        Number(unit.retained_from) > Number(unit.revision)
      )
        throw invalid();
      content(
        item.id,
        String(unit.snapshot),
        item.kind as DocumentKind,
        String(unit.unit_id),
        true,
      );
      let initialRevision = 1;
      if (hasTransition) {
        const receipt = db
          .prepare(
            'SELECT revision,snapshot_hash FROM spinel_sync_transition_units WHERE unit_id=?',
          )
          .get(unit.unit_id);
        if (receipt) {
          initialRevision = Number(receipt.revision);
          if (
            initialRevision > Number(unit.revision) ||
            initialRevision > Number(unit.retained_from) ||
            (initialRevision === unit.revision &&
              createHash('sha256').update(String(unit.snapshot)).digest('hex') !==
                receipt.snapshot_hash)
          )
            throw invalid();
        }
      }
      if (!exists(db, 'spinel_sync_revisions')) throw invalid();
      const revisions = db
        .prepare(
          'SELECT count(*) AS n,min(revision) AS lo,max(revision) AS hi FROM spinel_sync_revisions WHERE unit_id=?',
        )
        .get(unit.unit_id)!;
      if (
        Number(revisions.n) !== Number(unit.revision) - initialRevision ||
        (Number(unit.revision) > initialRevision &&
          (revisions.lo !== initialRevision + 1 || revisions.hi !== unit.revision))
      )
        throw invalid();
    }
  if (exists(db, 'history_checkpoints'))
    for (const row of db.iterate('SELECT item_id,source,snapshot FROM history_checkpoints')) {
      const item = items.get(String(row.item_id));
      if (!item || !['doc', 'sheet'].includes(item.kind) || !(row.snapshot instanceof Uint8Array))
        throw invalid();
      const text = gunzipSync(row.snapshot, { maxOutputLength: MAX_SNAPSHOT_BYTES }).toString(
        'utf8',
      );
      content(item.id, text, item.kind as DocumentKind, item.id, row.source === 'collaboration');
    }
  if (exists(db, 'spinel_generation_resources'))
    for (const row of db.iterate(
      'SELECT item_id,unit_id,resources FROM spinel_generation_resources',
    )) {
      const item = items.get(String(row.item_id));
      const resources: unknown = JSON.parse(String(row.resources));
      if (
        !item ||
        !Array.isArray(resources) ||
        resources.some((r) => !r || typeof r.name !== 'string' || typeof r.data !== 'string')
      )
        throw invalid();
      imageSources({ id: String(row.unit_id), resources } as NativeSnapshot, (source) => {
        const prefix = `/api/items/${item.id}/images/`;
        if (
          !source.startsWith(prefix) ||
          !db
            .prepare('SELECT 1 FROM doc_images WHERE item_id=? AND id=?')
            .get(item.id, source.slice(prefix.length))
        )
          throw invalid();
        return source;
      });
    }
  return { snapshots, images };
}
