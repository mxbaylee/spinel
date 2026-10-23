import { basename, dirname, join, resolve } from 'node:path';

export function diagnosticsConfiguration(applicationPath: string, image?: string) {
  const application = resolve(applicationPath);
  return {
    applicationPath: application,
    path: join(dirname(application), basename(application) === 'diagnostics.sqlite' ? 'diagnostics-events.sqlite' : 'diagnostics.sqlite'),
    // Retain only the immutable digest, never a registry URL or branch name.
    build: image?.match(/@sha256:([a-f0-9]{64})$/i)?.[1].toLowerCase() ?? (image ? 'unknown' : 'development'),
  };
}
