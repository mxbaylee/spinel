import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Official immutable tools/trace_processor manifest, not a moving download alias.
// https://github.com/google/perfetto/blob/f5cb5074e59208ec89c65aeeed53cc9cf6204cd5/tools/trace_processor
export const DOC_TRACE_PROCESSOR = {
  release: 'v59.1',
  source: '1e9c61e9844affd7dccd3d42d9ea9f3a3d10cf6d',
  manifest: 'f5cb5074e59208ec89c65aeeed53cc9cf6204cd5',
  binaries: {
    'darwin-arm64': {
      target: 'mac-arm64',
      bytes: 14_376_168,
      sha256: '8488edbefadfc4be152cda1d42d9bfcede8b47638295eb85eb3bad8cd148fdf4',
    },
    'linux-x64': {
      target: 'linux-amd64',
      bytes: 15_885_448,
      sha256: '2434129a3af4dc9e2034a476f7b76447b490975213e301769310d3bd0d5d6458',
    },
  },
} as const;

export function docTraceProcessorAuthority(
  platform: string = process.platform,
  arch: string = process.arch,
) {
  const key = `${platform}-${arch}`;
  if (!Object.hasOwn(DOC_TRACE_PROCESSOR.binaries, key))
    throw new Error(`No verified callback trace converter for ${key}.`);
  const binary = DOC_TRACE_PROCESSOR.binaries[key as keyof typeof DOC_TRACE_PROCESSOR.binaries];
  return {
    release: DOC_TRACE_PROCESSOR.release,
    source: DOC_TRACE_PROCESSOR.source,
    manifest: DOC_TRACE_PROCESSOR.manifest,
    platform: key,
    ...binary,
    url: `https://commondatastorage.googleapis.com/perfetto-luci-artifacts/${DOC_TRACE_PROCESSOR.release}/${binary.target}/trace_processor_shell`,
  };
}

export function verifyDocTraceProcessorBytes(
  bytes: Uint8Array,
  authority = docTraceProcessorAuthority(),
) {
  if (
    bytes.length !== authority.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== authority.sha256
  )
    throw new Error('Callback trace converter differs from its pinned official binary.');
  return authority;
}

export async function verifyDocTraceProcessor(path: string) {
  return verifyDocTraceProcessorBytes(await readFile(path));
}

/** Explicit setup only: browser observations never download or select a latest version. */
export async function installDocTraceProcessor(path: string) {
  const authority = docTraceProcessorAuthority();
  await mkdir(dirname(path), { recursive: true });
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error('Converter download deadline.')),
    60_000,
  );
  let owned = false;
  try {
    const response = await fetch(authority.url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok || !response.body)
      throw new Error(`Converter download HTTP ${response.status}.`);
    const parts: Uint8Array[] = [];
    let length = 0;
    for await (const part of response.body) {
      length += part.length;
      if (length > authority.bytes) {
        controller.abort();
        throw new Error('Converter download exceeds its pinned byte length.');
      }
      parts.push(part);
    }
    const bytes = Buffer.concat(parts);
    verifyDocTraceProcessorBytes(bytes, authority);
    const output = await open(path, 'wx', 0o600);
    owned = true;
    try {
      await output.writeFile(bytes);
    } finally {
      await output.close();
    }
    await chmod(path, 0o700);
    return authority;
  } catch (error) {
    if (owned) await rm(path, { force: true });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node scripts/ci/doc-trace-processor.ts <new-binary-path>');
  console.log(JSON.stringify(await installDocTraceProcessor(resolve(path))));
}
