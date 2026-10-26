import { crc32 } from 'node:zlib';
import type { Readable } from 'node:stream';
import { openPromise } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { ARCHIVE_ITEM_LIMIT, ARCHIVE_LIMIT, ARCHIVE_MANIFEST_LIMIT } from '../../shared/archive.ts';
import { PORTABLE_LIMIT } from '../../shared/portable.ts';
import { AuthError } from '../auth/store.ts';
import { ARCHIVE_MANIFEST, archiveDirectories } from './archive-manifest.ts';
import type { ArchiveManifest } from './archive-manifest.ts';

const invalid = () => new AuthError(400, 'Choose a valid, complete Spinel ZIP archive.');
const excessive = () => new AuthError(413, 'The archive exceeds its item or 8 GiB transfer limit.');
const safeSize = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Central-directory discovery is bounded; payloads are read and checked one at a time. */
export class ArchiveZip {
  readonly entries = new Map<string, Entry>();
  expandedBytes = 0;
  private readonly zip: ZipFile;
  private readonly verify: () => void;
  private readonly consumed = new Set<string>();
  private failure: Error | undefined;
  private current: Readable | undefined;
  private constructor(zip: ZipFile, verify: () => void) {
    this.zip = zip;
    this.verify = verify;
    // eachEntry owns its promise listener only while enumerating. Keep errors
    // consumed during later payload reads and asynchronous descriptor cleanup.
    zip.on('error', (error: Error) => {
      this.failure = error;
      this.current?.destroy(error);
    });
  }
  static async open(path: string, verify: () => void): Promise<ArchiveZip> {
    let zip: ZipFile | undefined;
    let archive: ArchiveZip | undefined;
    try {
      verify();
      zip = await openPromise(path, {
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      });
      archive = new ArchiveZip(zip, verify);
      verify();
      if (
        !safeSize(zip.fileSize) ||
        zip.fileSize > ARCHIVE_LIMIT ||
        !safeSize(zip.entryCount) ||
        zip.entryCount > 2 * ARCHIVE_ITEM_LIMIT + 1
      )
        throw excessive();
      let expanded = 0;
      let compressed = 0;
      let metadata = 0;
      for await (const entry of zip.eachEntry()) {
        verify();
        const directory = entry.fileName.endsWith('/');
        const path = directory ? entry.fileName.slice(0, -1) : entry.fileName;
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (
          !path ||
          path.startsWith('/') ||
          /^[a-z]:/i.test(path) ||
          /[\\\p{Cc}]/u.test(path) ||
          path.split('/').some((part) => !part || part === '.' || part === '..') ||
          archive.entries.has(entry.fileName) ||
          entry.isEncrypted() ||
          (entry.generalPurposeBitFlag & ~0x080e) !== 0 ||
          ![0, 8].includes(entry.compressionMethod) ||
          (mode !== 0 && mode !== (directory ? 0o040000 : 0o100000)) ||
          !safeSize(entry.uncompressedSize) ||
          !safeSize(entry.compressedSize) ||
          (directory &&
            (entry.uncompressedSize !== 0 || entry.compressedSize !== 0 || entry.crc32 !== 0))
        )
          throw invalid();
        if (
          !directory &&
          entry.uncompressedSize >
            (entry.fileName === ARCHIVE_MANIFEST ? ARCHIVE_MANIFEST_LIMIT : PORTABLE_LIMIT)
        )
          throw new AuthError(413, 'An archive member exceeds its native file or manifest limit.');
        expanded += entry.uncompressedSize;
        compressed += entry.compressedSize;
        metadata += entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength + 128;
        if (
          expanded > ARCHIVE_LIMIT ||
          compressed > ARCHIVE_LIMIT ||
          metadata > 2 * ARCHIVE_MANIFEST_LIMIT ||
          archive.entries.size >= 2 * ARCHIVE_ITEM_LIMIT + 1
        )
          throw excessive();
        // Yauzl intentionally trusts central records. Check the corresponding
        // public local header too, so another ZIP reader cannot see a second path.
        const local = await zip.readLocalFileHeaderPromise(entry);
        verify();
        if (
          !local.fileName.equals(entry.fileNameRaw) ||
          local.compressionMethod !== entry.compressionMethod ||
          local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
          local.fileDataStart + entry.compressedSize > zip.fileSize
        )
          throw invalid();
        archive.entries.set(entry.fileName, entry);
      }
      if (!archive.entries.has(ARCHIVE_MANIFEST)) throw invalid();
      archive.expandedBytes = expanded;
      return archive;
    } catch (error) {
      if (archive) await archive.close().catch(() => {});
      else zip?.close();
      if (error instanceof AuthError) throw error;
      throw invalid();
    }
  }
  match(manifest: ArchiveManifest) {
    const expected = new Set([
      ARCHIVE_MANIFEST,
      ...archiveDirectories(manifest.items),
      ...manifest.items
        .filter((item) => item.kind === 'doc' || item.kind === 'sheet')
        .map((item) => item.path),
    ]);
    if (
      expected.size !== this.entries.size ||
      [...expected].some((path) => !this.entries.has(path))
    )
      throw invalid();
  }
  async read(path: string, limit: number): Promise<Buffer> {
    const entry = this.entries.get(path);
    if (!entry || entry.fileName.endsWith('/') || this.consumed.has(path)) throw invalid();
    if (entry.uncompressedSize > limit) throw excessive();
    this.consumed.add(path);
    let stream: Awaited<ReturnType<ZipFile['openReadStreamPromise']>> | undefined;
    try {
      this.verify();
      if (this.failure) throw this.failure;
      stream = await this.zip.openReadStreamPromise(entry);
      this.current = stream;
      this.verify();
      let size = 0;
      let checksum = 0;
      const chunks: Buffer[] = [];
      for await (const value of stream) {
        this.verify();
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size > limit || size > entry.uncompressedSize) throw excessive();
        checksum = crc32(chunk, checksum);
        chunks.push(chunk);
      }
      this.verify();
      if (this.failure) throw this.failure;
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw invalid();
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw invalid();
    } finally {
      stream?.destroy();
      if (this.current === stream) this.current = undefined;
    }
  }
  async close() {
    if (!this.zip.isOpen) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        clean();
        resolve();
      };
      const error = (failure: Error) => {
        clean();
        reject(failure);
      };
      const clean = () => {
        this.zip.off('close', done);
        this.zip.off('error', error);
      };
      this.zip.once('close', done);
      this.zip.once('error', error);
      this.zip.close();
    });
  }
}
