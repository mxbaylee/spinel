import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundledDependencies',
  'bundleDependencies',
  'overrides',
  'resolutions',
] as const;

function isPro(value: string) {
  try {
    value = decodeURIComponent(value);
  } catch {
    // Invalid URL escapes do not stop ordinary package-name inspection.
  }
  return /@univerjs-pro\//i.test(value);
}

/** Check names and values: npm aliases can hide the actual package behind an
 * unrelated dependency key, including inside a transitive lockfile entry. */
function inspect(value: unknown, location: string, failures: Set<string>) {
  if (typeof value === 'string') {
    if (isPro(value)) failures.add(location);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const path = `${location}.${key}`;
      if (isPro(key)) failures.add(path);
      inspect(child, path, failures);
    }
  }
}

/** Read committed dependency inputs, independent of the local node_modules.
 * Historical docs and the separate, explicitly supplied legacy export checkout
 * are not part of this application's dependency graph. */
export function assertNoUniverPro(directory = process.cwd()) {
  const read = (file: string) => JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
  const root = read('package.json');
  const workspaces: unknown = root.workspaces ?? [];
  if (!Array.isArray(workspaces) || workspaces.some((path) => typeof path !== 'string'))
    throw new Error('package.json workspaces must be an array of package paths.');
  const manifests = new Set([
    'package.json',
    ...globSync(
      workspaces.map((path: string) => `${path}/package.json`),
      { cwd: directory },
    ),
  ]);
  const failures = new Set<string>();
  for (const file of manifests) {
    const manifest = file === 'package.json' ? root : read(file);
    inspect(manifest.name, `${file}.name`, failures);
    for (const field of dependencyFields) inspect(manifest[field], `${file}.${field}`, failures);
  }
  const lock = read('package-lock.json');
  if (
    ![2, 3].includes(lock.lockfileVersion) ||
    !lock.packages ||
    typeof lock.packages !== 'object' ||
    Array.isArray(lock.packages)
  )
    throw new Error('package-lock.json must contain the resolved npm package inventory.');
  inspect(lock, 'package-lock.json', failures);
  if (failures.size)
    throw new Error(`Univer Pro dependencies are prohibited:\n${[...failures].sort().join('\n')}`);
  return manifests.size;
}

if (import.meta.main) {
  const count = assertNoUniverPro();
  console.log(`No Univer Pro dependencies in ${count} manifests or the resolved lockfile.`);
}
