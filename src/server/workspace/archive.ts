import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { DatabaseSync } from '../../../server/database.ts';
import { ARCHIVE_LIMIT, ARCHIVE_MANIFEST_LIMIT } from '../../shared/archive.ts';
import type { ArchiveImportResult } from '../../shared/archive.ts';
import { PORTABLE_LIMIT } from '../../shared/portable.ts';
import { AuthError } from '../auth/store.ts';
import { archiveCapacity } from './archive-storage.ts';
import {
  ARCHIVE_MANIFEST,
  archiveDirectories,
  ownedArchiveManifest,
  parseArchiveManifest,
  verifyArchivePlan,
} from './archive-manifest.ts';
import type { ArchiveItem } from './archive-manifest.ts';
import { ArchiveZip } from './archive-zip.ts';
import type { PortableFiles } from './portable.ts';
import type { WorkspaceStore } from './store.ts';

type Progress = (progress: { completed: number; total: number }) => void;
const native = (item: ArchiveItem) => item.kind === 'doc' || item.kind === 'sheet';
const failed = () => new AuthError(400, 'Choose a valid, complete Spinel archive.');
const tooLarge = () =>
  new AuthError(413, 'The archive exceeds its transfer or temporary storage limit.');
// Eight GiB of portable content may need additional SQLite pages and indexes.
const STAGE_LIMIT = 9 * 1024 * 1024 * 1024;
function utf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw failed();
  }
}
function json(bytes: Buffer): unknown {
  try {
    return JSON.parse(utf8(bytes));
  } catch {
    throw failed();
  }
}

/** Chunking makes the ZIP compressor's backpressure independent of a member's size. */
function bytesStream(bytes: Buffer) {
  return Readable.from(
    (function* () {
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024)
        yield bytes.subarray(offset, offset + 64 * 1024);
    })(),
    { objectMode: false, highWaterMark: 64 * 1024 },
  );
}

export class WorkspaceArchive {
  private readonly workspace: WorkspaceStore;
  private readonly files: PortableFiles;
  private readonly custom: Readonly<Record<string, unknown>>;
  constructor(
    workspace: WorkspaceStore,
    files: PortableFiles,
    customData: Record<string, unknown> = {},
  ) {
    this.workspace = workspace;
    this.files = files;
    this.custom = Object.freeze({ ...customData });
  }
  async *export(user: string, verify: () => void, progress?: Progress): AsyncGenerator<Buffer> {
    const check = () => {
      verify();
      this.workspace.owner(user);
    };
    check();
    const manifest = ownedArchiveManifest(this.workspace, user);
    const members = manifest.items.filter(native);
    const database = this.workspace.auth.database;
    const changes = database.prepare('SELECT total_changes() AS count');
    const version = database.prepare('PRAGMA data_version');
    let checkedVersion = '';
    const streamCheck = () => {
      check();
      // total_changes sees this connection's writes; data_version sees commits
      // by the SDK or another connection. Recheck the whole owned graph when
      // either changes, because buffered ZIP chunks can span several entries.
      const currentVersion = `${changes.get()!.count}:${version.get()!.data_version}`;
      if (currentVersion !== checkedVersion) {
        verifyArchivePlan(this.workspace, user, manifest.items);
        checkedVersion = currentVersion;
      }
    };
    progress?.({ completed: 0, total: members.length });
    const zip = new ZipFile();
    const output = zip.outputStream as Readable;
    let stopped = false;
    let current: Readable | undefined;
    let preparing: Promise<void> | undefined;
    let expanded = 0;
    let completed = 0;
    zip.on('error', (error: Error) => output.destroy(error));
    const add = (
      path: string,
      updatedAt: number,
      content: () => Promise<Buffer>,
      count: boolean,
    ) => {
      zip.addReadStreamLazy(
        path,
        { mtime: new Date(updatedAt), mode: 0o100600, compressionLevel: 6 },
        (callback) => {
          preparing = (async () => {
            check();
            const bytes = await content();
            check();
            if (stopped) throw new AuthError(499, 'The archive download was cancelled.');
            expanded += bytes.length;
            if (expanded > ARCHIVE_LIMIT) throw tooLarge();
            const stream = bytesStream(bytes);
            current = stream;
            stream.once('error', (error) => output.destroy(error));
            stream.once('end', () => {
              try {
                if (count && !stopped)
                  progress?.({ completed: ++completed, total: members.length });
              } catch (error) {
                output.destroy(
                  error instanceof Error ? error : new Error('Archive progress failed.'),
                );
              }
            });
            callback(null, stream);
          })().catch((error: unknown) => {
            // Yazl emits callback errors; one permanent listener owns their delivery.
            callback(error, undefined as unknown as Readable);
          });
        },
      );
    };
    try {
      for (const path of archiveDirectories(manifest.items))
        zip.addEmptyDirectory(path, { mode: 0o040700 });
      for (const item of members)
        add(
          item.path,
          item.updatedAt,
          async () => {
            verifyArchivePlan(this.workspace, user, [item]);
            const custom =
              item.spaceId === null
                ? this.custom
                : { ...this.custom, spaceId: item.spaceId, spaceItem: item.id };
            const file = await this.files.export(user, item.id, check, custom);
            verifyArchivePlan(this.workspace, user, [item]);
            return Buffer.from(file.text);
          },
          true,
        );
      // The final manifest is also the tree/session fence. Failure prevents the
      // central directory from completing and cannot yield a valid partial archive.
      add(
        ARCHIVE_MANIFEST,
        manifest.exportedAt,
        async () => {
          verifyArchivePlan(this.workspace, user, manifest.items);
          return Buffer.from(JSON.stringify(manifest));
        },
        false,
      );
      zip.end();
      let emitted = 0;
      for await (const value of output) {
        streamCheck();
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        emitted += chunk.length;
        if (emitted > ARCHIVE_LIMIT) throw tooLarge();
        yield chunk;
      }
      streamCheck();
    } finally {
      stopped = true;
      current?.destroy();
      output.destroy();
      // A disconnected client cannot release admission while a native load is
      // still running; its result is discarded after the await above completes.
      await preparing;
    }
  }
  async import(
    user: string,
    zipPath: string,
    verify: () => void,
    progress?: Progress,
  ): Promise<ArchiveImportResult> {
    const check = () => {
      verify();
      this.workspace.owner(user);
    };
    check();
    let archive: ArchiveZip | undefined;
    let stage: DatabaseSync | undefined;
    let attached = false;
    const stagePath = join(dirname(zipPath), `stage-${randomUUID()}.sqlite`);
    const database = this.workspace.auth.database;
    try {
      archive = await ArchiveZip.open(zipPath, check);
      const manifestBytes = await archive.read(ARCHIVE_MANIFEST, ARCHIVE_MANIFEST_LIMIT);
      const manifest = parseArchiveManifest(utf8(manifestBytes), this.workspace);
      archive.match(manifest);
      const members = manifest.items.filter(native);
      progress?.({ completed: 0, total: members.length });
      // Include conservative SQLite page/index overhead plus space for the live
      // destination and its transaction WAL. Nothing is attached or published yet.
      await archiveCapacity(dirname(zipPath), 3 * (archive.expandedBytes + 128 * 1024 * 1024));
      check();
      stage = new DatabaseSync(stagePath);
      await chmod(stagePath, 0o600);
      check();
      stage.exec(`
        PRAGMA page_size=4096;
        PRAGMA max_page_count=${STAGE_LIMIT / 4096};
        PRAGMA cache_size=-8192;
        PRAGMA temp_store=FILE;
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE items (
          ordinal INTEGER NOT NULL, id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
          parent_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          space_id TEXT, space_position INTEGER
        ) STRICT;
        CREATE TABLE snapshots (
          item_id TEXT PRIMARY KEY, kind TEXT NOT NULL, snapshot TEXT NOT NULL, write_id TEXT NOT NULL
        ) STRICT;
        CREATE TABLE images (
          item_id TEXT NOT NULL, id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
          PRIMARY KEY(item_id,id)
        ) STRICT;
      `);
      // All identities precede native preparation, including forward references.
      const ids = new Map(manifest.items.map((item) => [item.id, randomUUID()]));
      const sheets = new Set(
        manifest.items.filter((item) => item.kind === 'sheet').map((item) => item.id),
      );
      const unavailable = new Map<string, string>();
      const mapSource = (id: string) => {
        if (sheets.has(id)) return ids.get(id)!;
        let missing = unavailable.get(id);
        if (!missing) {
          // Match a workspace UUID's 36 characters, preserving a file exactly at
          // its native save limit. The reserved prefix can never bind a UUID item.
          missing = `unavailable-${randomBytes(18).toString('base64url')}`;
          unavailable.set(id, missing);
        }
        return missing;
      };
      const now = this.workspace.auth.now();
      const itemInsert = stage.prepare('INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (let ordinal = 0; ordinal < manifest.items.length; ordinal++) {
        const item = manifest.items[ordinal];
        itemInsert.run(
          ordinal,
          ids.get(item.id)!,
          user,
          item.parentId === null ? null : ids.get(item.parentId)!,
          item.kind,
          item.name,
          now,
          now,
          item.spaceId === null ? null : ids.get(item.spaceId)!,
          item.position,
        );
      }
      let completed = 0;
      for (const item of members) {
        const bytes = await archive.read(item.path, PORTABLE_LIMIT);
        const snapshot = json(bytes);
        check();
        const prepared = await this.files.prepare(
          { filename: `${item.name}.univer.json`, snapshot },
          mapSource,
        );
        check();
        if (prepared.kind !== item.kind) throw failed();
        const id = ids.get(item.id)!;
        const text = JSON.stringify(this.files.materialize(prepared, id));
        const images = new Map([...prepared.images.values()].map((image) => [image.id, image]));
        stage
          .prepare('INSERT INTO snapshots VALUES(?,?,?,?)')
          .run(id, item.kind, text, randomUUID());
        const imageInsert = stage.prepare('INSERT INTO images VALUES(?,?,?,?)');
        for (const image of images.values()) imageInsert.run(id, image.id, image.mime, image.data);
        progress?.({ completed: ++completed, total: members.length });
      }
      stage.close();
      stage = undefined;
      const size = (await stat(stagePath)).size;
      if (size > STAGE_LIMIT) throw tooLarge();
      await archiveCapacity(dirname(zipPath), 2 * size + 128 * 1024 * 1024);
      check();
      database.prepare('ATTACH DATABASE ? AS workspace_archive_import').run(stagePath);
      attached = true;
      this.workspace.auth.transaction(() => {
        check();
        const columns = new Set(
          database
            .prepare('PRAGMA table_info(workspace_items)')
            .all()
            .map((row) => row.name),
        );
        const membership = columns.has('space_id') ? ',space_id,space_position' : '';
        if (!membership && manifest.items.some((item) => item.kind === 'space')) throw failed();
        database.exec(`
          INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at${membership})
          SELECT id,owner_id,parent_id,kind,name,created_at,updated_at${membership}
          FROM workspace_archive_import.items ORDER BY ordinal;
          INSERT INTO doc_images(item_id,id,mime,data)
          SELECT item_id,id,mime,data FROM workspace_archive_import.images;
          INSERT INTO doc_snapshots(item_id,snapshot,revision,write_id)
          SELECT item_id,snapshot,1,write_id FROM workspace_archive_import.snapshots WHERE kind='doc';
          INSERT INTO sheet_snapshots(item_id,snapshot,revision,write_id)
          SELECT item_id,snapshot,1,write_id FROM workspace_archive_import.snapshots WHERE kind='sheet';
        `);
        check();
      });
      return {
        items: manifest.items.length,
        files: members.length,
        folders: manifest.items.filter((item) => item.kind === 'folder').length,
        spaces: manifest.items.filter((item) => item.kind === 'space').length,
      };
    } finally {
      let cleanupError: unknown;
      try {
        await archive?.close();
      } catch (error) {
        cleanupError = error;
      }
      try {
        if (stage?.isOpen) stage.close();
      } catch (error) {
        cleanupError ??= error;
      }
      try {
        if (attached) database.exec('DETACH DATABASE workspace_archive_import');
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError) {
        // Keep the original failure before publication, or the successful result
        // afterward. A cleanup error must never change either outcome.
        console.error('Archive import temporary database cleanup failed.');
      }
    }
  }
}
