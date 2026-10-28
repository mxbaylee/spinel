import { createReadStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { addAbortSignal } from 'node:stream';
import type { SpacesConfig } from './config.ts';
import type { RemoteStore } from './destination.ts';
import { RecoveryResourceError } from './resource-error.ts';
import { archiveDigest, MAX_ARCHIVE_BYTES, transferArchive } from './transfer.ts';
export { loadConfig } from './config.ts';
export type { BackupConfig } from './config.ts';
export type { RemoteStore } from './destination.ts';
const TRANSFER_MS = 30 * 60_000;
const MAX_ENTRIES = 10_000;
export class SpacesStore implements RemoteStore {
  client: S3Client;
  config: SpacesConfig;
  constructor(config: SpacesConfig) {
    this.config = config;
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: `https://${config.region}.digitaloceanspaces.com`,
      // Only the configured Spaces region may receive recovery bytes. Do not
      // let generic AWS endpoint environment settings redirect this client.
      ignoreConfiguredEndpointUrls: true,
      useFipsEndpoint: false,
      useDualstackEndpoint: false,
      forcePathStyle: false,
      maxAttempts: 3,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  private validKey(key: string, pending = false) {
    if (!backupTime(pending ? key.replace(/\.pending$/, '') : key, this.config.prefix))
      throw new Error('Not a backup in this instance prefix.');
  }
  async put(key: string, path: string, sha256: string, signal: AbortSignal) {
    this.validKey(key);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid backup checksum.');
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(TRANSFER_MS)]);
    bounded.throwIfAborted();
    const size = (await stat(path)).size;
    // PutObject has a 5 GiB ceiling. Fail visibly rather than upload a truncated backup.
    if (size > MAX_ARCHIVE_BYTES) throw new RecoveryResourceError('archive-size');
    const pending = `${key}.pending`;
    const body = addAbortSignal(bounded, createReadStream(path));
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: pending,
          Body: body,
          ContentLength: size,
          ContentType: 'application/octet-stream',
          ACL: 'private',
        }),
        { abortSignal: bounded },
      );
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: pending }),
        { abortSignal: bounded },
      );
      if (!result.Body) throw new Error('Uploaded backup could not be read.');
      const stored = addAbortSignal(bounded, result.Body as Readable);
      try {
        if (result.ContentLength !== undefined && result.ContentLength > MAX_ARCHIVE_BYTES)
          throw new RecoveryResourceError('archive-size');
        if (result.ContentLength !== undefined && result.ContentLength !== size)
          throw new Error('Uploaded backup transfer is incomplete.');
        if ((await archiveDigest(stored, bounded, size)) !== sha256)
          throw new Error('Uploaded backup checksum mismatch.');
      } finally {
        stored.destroy();
      }
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          CopySource: `${this.config.bucket}/${encodeURIComponent(pending)}`,
          ACL: 'private',
        }),
        { abortSignal: bounded },
      );
    } finally {
      body.destroy();
      // Abort does not excuse leaving run-owned staging. A fresh bounded signal
      // also cleans interrupted uploads; restart cleanup retries failed cleanup.
      await this.remove(pending, AbortSignal.timeout(15_000));
    }
  }
  private async keys(signal: AbortSignal) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(TRANSFER_MS)]);
    bounded.throwIfAborted();
    const keys: string[] = [];
    let token: string | undefined;
    let entries = 0;
    const pages = new Set<string>();
    do {
      bounded.throwIfAborted();
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: `${this.config.prefix}/`,
          ContinuationToken: token,
        }),
        { abortSignal: bounded },
      );
      bounded.throwIfAborted();
      for (const object of result.Contents ?? []) {
        if (++entries > MAX_ENTRIES) throw new Error('Backup catalog exceeds its entry limit.');
        if (object.Key) keys.push(object.Key);
      }
      if (
        result.IsTruncated &&
        (!result.NextContinuationToken || pages.has(result.NextContinuationToken))
      )
        throw new Error('Incomplete backup listing.');
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
      if (token) pages.add(token);
      if (pages.size > MAX_ENTRIES) throw new Error('Backup catalog exceeds its page limit.');
    } while (token);
    return keys;
  }
  async list(signal: AbortSignal) {
    return (await this.keys(signal)).filter((key) => backupTime(key, this.config.prefix));
  }
  async cleanup(signal: AbortSignal) {
    // Caller holds the shared recovery lease: no publisher is still using these.
    for (const key of await this.keys(signal)) {
      if (key.endsWith('.pending') && backupTime(key.slice(0, -8), this.config.prefix))
        await this.remove(key, signal);
    }
  }
  async remove(key: string, signal: AbortSignal) {
    this.validKey(key, true);
    signal.throwIfAborted();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      abortSignal: signal,
    });
  }
  async download(key: string, destination: string, signal = AbortSignal.timeout(TRANSFER_MS)) {
    this.validKey(key);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(TRANSFER_MS)]);
    bounded.throwIfAborted();
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: bounded },
    );
    if (!result.Body) throw new Error('Backup is empty.');
    const body = addAbortSignal(bounded, result.Body as Readable);
    let output: FileHandle | undefined;
    let created = false;
    try {
      if (result.ContentLength !== undefined && result.ContentLength > MAX_ARCHIVE_BYTES)
        throw new RecoveryResourceError('archive-size');
      output = await open(destination, 'wx', 0o600);
      created = true;
      const checksum = await transferArchive(
        body,
        output,
        bounded,
        result.ContentLength,
        destination,
      );
      await output.sync();
      return checksum;
    } catch (error) {
      if (created) await unlink(destination);
      throw error;
    } finally {
      body.destroy();
      await output?.close();
    }
  }
  close() {
    this.client.destroy();
  }
}
export function backupTime(key: string, prefix: string) {
  if (!key.startsWith(`${prefix}/`)) return null;
  const match = key
    .slice(prefix.length + 1)
    .match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-[a-f0-9-]{36}\.spinel$/);
  if (!match) return null;
  const date = new Date(match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'));
  return Number.isFinite(date.getTime()) ? date : null;
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const month = (d: Date) => d.toISOString().slice(0, 7);
function week(d: Date) {
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return day(monday);
}
export function expiredBackups(keys: string[], prefix: string, now: Date) {
  const valid = keys
    .map((key) => ({ key, date: backupTime(key, prefix) }))
    .filter((x) => x.date !== null)
    .sort((a, b) => b.date!.getTime() - a.date!.getTime() || b.key.localeCompare(a.key));
  const periods = [new Set<string>(), new Set<string>(), new Set<string>()];
  // Calendar buckets retain up to 7 daily + 4 weekly + 6 monthly recovery points.
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    periods[0].add(day(d));
  }
  for (let i = 0; i < 4; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    periods[1].add(week(d));
  }
  for (let i = 0; i < 6; i++) {
    const d = new Date(now);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    periods[2].add(month(d));
  }
  const keep = new Set(valid.slice(0, 1).map((x) => x.key));
  for (const { key, date } of valid) {
    // Clock-skewed future objects are never pruned by this run.
    if (date! > now) keep.add(key);
    [day(date!), week(date!), month(date!)].forEach((period, i) => {
      if (periods[i].delete(period)) keep.add(key);
    });
  }
  return valid.filter((x) => !keep.has(x.key)).map((x) => x.key);
}
