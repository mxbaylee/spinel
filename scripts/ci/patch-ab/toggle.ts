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
 * 1.3.1 bundles. They are the same pins patch-univer-docs.test.ts asserts, repeated
 * here so a toggle that wrote the wrong build, or a drifted generator, fails the
 * job instead of only proving that a write round-trips.
 */
export const pinnedInstalled: Record<Variant, Installed> = {
  previous: {
    es: '83b7c9780e3c7e23767f65357915e6d419d3be64d9717f9d6f4c4588f0803a77',
    cjs: '4505cd09d6237053f43c2cdc32d3027be24d381a0917844f47c2c41949b5fa5c',
  },
  patched: {
    es: '788566fd844ad732f3dce124c64daf9f14a742487b5e11191d96da7c82b0563c',
    cjs: 'f5d9d7a67e528159e16bb1abc341f4efd7b62dcfa29d18d925c7bd60904626a9',
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
