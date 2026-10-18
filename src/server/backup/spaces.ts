import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { digest, privateFile } from './archive.ts';

export interface BackupConfig {
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyFile: string;
  runtimeEnvironmentFile: string;
}
export async function loadConfig(path: string): Promise<BackupConfig> {
  const c = JSON.parse((await privateFile(path)).toString()) as BackupConfig;
  if (
    !c ||
    !/^[a-z]{3}[0-9]+$/.test(c.region) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(c.bucket) ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(c.prefix) ||
    !['accessKeyId', 'secretAccessKey', 'keyFile', 'runtimeEnvironmentFile'].every(
      (k) =>
        typeof c[k as keyof BackupConfig] === 'string' && c[k as keyof BackupConfig].length > 0,
    )
  )
    throw new Error('Invalid backup configuration.');
  return c;
}
export interface RemoteStore {
  put(key: string, path: string, sha256: string, signal: AbortSignal): Promise<void>;
  list(signal: AbortSignal): Promise<string[]>;
  remove(key: string, signal: AbortSignal): Promise<void>;
}
export class SpacesStore implements RemoteStore {
  client: S3Client;
  config: BackupConfig;
  constructor(config: BackupConfig) {
    this.config = config;
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: `https://${config.region}.digitaloceanspaces.com`,
      forcePathStyle: false,
      maxAttempts: 3,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  async put(key: string, path: string, sha256: string, signal: AbortSignal) {
    const size = (await stat(path)).size;
    // PutObject has a 5 GiB ceiling. Fail visibly rather than upload a truncated backup.
    if (size > 5 * 1024 ** 3) throw new Error('Backup exceeds single-object upload limit.');
    const pending = `${key}.pending`;
    const body = createReadStream(path);
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
        { abortSignal: signal },
      );
    } finally {
      body.destroy();
    }
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: pending }),
      { abortSignal: signal },
    );
    if (!result.Body) throw new Error('Uploaded backup could not be read.');
    const hash = createHash('sha256');
    for await (const chunk of result.Body as Readable) hash.update(chunk);
    if (hash.digest('hex') !== sha256) throw new Error('Uploaded backup checksum mismatch.');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        CopySource: `${this.config.bucket}/${encodeURIComponent(pending)}`,
        ACL: 'private',
      }),
      { abortSignal: signal },
    );
    await this.remove(pending, signal);
  }
  async list(signal: AbortSignal) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: `${this.config.prefix}/`,
          ContinuationToken: token,
        }),
        { abortSignal: signal },
      );
      for (const object of result.Contents ?? []) if (object.Key) keys.push(object.Key);
      if (
        result.IsTruncated &&
        (!result.NextContinuationToken || result.NextContinuationToken === token)
      )
        throw new Error('Incomplete backup listing.');
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
  async remove(key: string, signal: AbortSignal) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      abortSignal: signal,
    });
  }
  async download(key: string, destination: string) {
    if (!backupTime(key, this.config.prefix))
      throw new Error('Not a backup in this instance prefix.');
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30 * 60_000) },
    );
    if (!result.Body) throw new Error('Backup is empty.');
    await pipeline(
      result.Body as Readable,
      createWriteStream(destination, { mode: 0o600, flags: 'wx' }),
    );
    return digest(destination);
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
