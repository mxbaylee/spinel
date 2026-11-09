// Opt-in SPN-146 attribution experiment (.github/workflows/patch-ab.yml); remove with the workflow.
// Rewrites the installed @univerjs/core bundles so Univer's immediate macrotask helper either builds one
// MessageChannel per call (previous, upstream) or shares one (patched, this PR), reads the files back and
// records their sha256 and which function they contain.
//   node scripts/ci/patch-ab/core-channel.ts previous|patched [installed-core.json]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCore } from '../../dependencies/patch-univer-core.ts';
import { variantName } from './toggle.ts';
import type { Variant } from './toggle.ts';

const formats = ['es', 'cjs'] as const;

export async function toggleChannel(root: string, variant: Variant) {
  const record: Record<string, string | boolean> = { variant };
  for (const format of formats) {
    const path = resolve(root, 'node_modules/@univerjs/core/lib', format, 'index.js');
    const next = patchCore(await readFile(path, 'utf8'), format, {
      pooledChannel: variant === 'patched',
    });
    await writeFile(path, next);
    const written = await readFile(path, 'utf8');
    const pooled = written.includes('const pendingMacroTasks = [];');
    // Read back: a toggle that wrote the other build must fail the job, not only round-trip.
    if (pooled !== (variant === 'patched'))
      throw new Error(`Installed core ${format} for ${variant} has pooled=${pooled}.`);
    record[format] = createHash('sha256').update(written).digest('hex');
    record[`${format}Pooled`] = pooled;
  }
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = await toggleChannel(
    resolve(import.meta.dirname, '../../..'),
    variantName(process.argv[2]),
  );
  console.log(JSON.stringify(record));
  if (process.argv[3]) {
    await mkdir(dirname(process.argv[3]), { recursive: true });
    await writeFile(process.argv[3], `${JSON.stringify(record)}\n`);
  }
}
