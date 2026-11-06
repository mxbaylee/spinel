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

/** Throws unless every installed hash is the one this variant should produce. */
export function assertInstalled(variant: Variant, expected: Installed, actual: Installed) {
  for (const format of formats)
    if (expected[format] !== actual[format])
      throw new Error(
        `Installed ${format} for ${variant} is ${actual[format]}, expected ${expected[format]}.`,
      );
}

export async function toggle(root: string, variant: Variant) {
  const expected = {} as Installed;
  const actual = {} as Installed;
  for (const format of formats) {
    const path = resolve(root, 'node_modules/@univerjs/docs/lib', format, 'index.js');
    const next = prepareDocsPatch(await readFile(path, 'utf8'), format)[variants[variant]];
    await writeFile(path, next);
    expected[format] = sha256(next);
    actual[format] = sha256(await readFile(path, 'utf8'));
  }
  assertInstalled(variant, expected, actual);
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
