// Opt-in SPN-146 attribution experiment (.github/workflows/patch-ab.yml); remove
// once the flush-tail question is answered. Rewrites the installed
// @univerjs/docs bundles to one named Docs build via prepareDocsPatch, reads the
// files back and records their sha256.
//   node scripts/ci/patch-ab/toggle.ts previous|patched [installed.json]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDocsPatch } from '../../dependencies/patch-univer-docs.ts';

const formats = ['es', 'cjs'] as const;
type Format = (typeof formats)[number];
/** `previous` is the build installed before this PR; `patched` is this PR's. */
export const variants = { previous: 'qualifiedRangesPatched', patched: 'patched' } as const;
export type Variant = keyof typeof variants;
export type Installed = Record<Format, string>;

export function variantName(value: string | undefined): Variant {
  if (value !== 'previous' && value !== 'patched')
    throw new Error(`Variant must be previous or patched, not ${value}.`);
  return value;
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Complete-module sha256 each variant must produce from the pinned @univerjs/docs
 * 1.1.0 bundles. They are the same pins patch-univer-docs.test.ts asserts, repeated
 * here so a toggle that wrote the wrong build, or a drifted generator, fails the
 * job instead of only proving that a write round-trips.
 */
export const pinnedInstalled: Record<Variant, Installed> = {
  previous: {
    es: '110890e889ac362b22a4c38bafd1ebb4e7cf82e8107d4524bdb86ff7fe6bd7c3',
    cjs: '58edceea5e1fb66ff1a83ec0a92707cf6f8d741aab87eb922d9c7e021f99207d',
  },
  patched: {
    es: '4b30f509d7426d43b5314f7d32422e0ca94830320d441712b6eed142af2b8dd5',
    cjs: '4ade808be25d9aed4122d1ab254a07802c89065c06cac42f9dec60fe2f2d286f',
  },
};

/** Throws unless every installed hash is the one this variant should produce. */
export function assertInstalled(variant: Variant, expected: Installed, actual: Installed) {
  for (const format of formats)
    if (expected[format] !== actual[format])
      throw new Error(
        `Installed ${format} for ${variant} is ${actual[format]}, expected ${expected[format]}.`,
      );
}

export async function toggle(root: string, variant: Variant) {
  const actual = {} as Installed;
  for (const format of formats) {
    const path = resolve(root, 'node_modules/@univerjs/docs/lib', format, 'index.js');
    const next = prepareDocsPatch(await readFile(path, 'utf8'), format)[variants[variant]];
    await writeFile(path, next);
    actual[format] = sha256(await readFile(path, 'utf8'));
  }
  assertInstalled(variant, pinnedInstalled[variant], actual);
  return { variant, ...actual };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = await toggle(
    resolve(import.meta.dirname, '../../..'),
    variantName(process.argv[2]),
  );
  console.log(JSON.stringify(record));
  if (process.argv[3]) {
    await mkdir(dirname(process.argv[3]), { recursive: true });
    await writeFile(process.argv[3], `${JSON.stringify(record)}\n`);
  }
}
