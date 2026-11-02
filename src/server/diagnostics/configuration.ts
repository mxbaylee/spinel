import { basename, dirname, join, resolve } from 'node:path';

/** Deployment may shorten the seven-day target, never disable expiry. */
export function diagnosticsRetentionDays(value: number | string = 7): number {
  if (typeof value === 'string' && !/^[1-7]$/.test(value))
    throw new Error('DIAGNOSTICS_RETENTION_DAYS must be a whole number from 1 through 7.');
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 7)
    throw new Error('DIAGNOSTICS_RETENTION_DAYS must be a whole number from 1 through 7.');
  return days;
}

export function diagnosticsConfiguration(
  applicationPath: string,
  image?: string,
  retentionDays?: number,
) {
  const application = resolve(applicationPath);
  return {
    applicationPath: application,
    retentionDays: diagnosticsRetentionDays(retentionDays),
    path: join(
      dirname(application),
      basename(application) === 'diagnostics.sqlite'
        ? 'diagnostics-events.sqlite'
        : 'diagnostics.sqlite',
    ),
    // Retain only the immutable digest, never a registry URL or branch name.
    build:
      image?.match(/@sha256:([a-f0-9]{64})$/i)?.[1].toLowerCase() ??
      (image ? 'unknown' : 'development'),
  };
}
