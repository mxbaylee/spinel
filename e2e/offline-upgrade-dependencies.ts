import { mkdir, readFile, readdir, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

interface LockedPackage {
  link?: boolean;
  resolved?: string;
  [key: string]: unknown;
}
interface Lockfile {
  packages: Record<string, LockedPackage>;
}

/** Reuse pinned external packages without importing the current workspace code. */
export async function linkLegacyOfflineDependencies(source: string, installed: string) {
  const readLock = async (root: string): Promise<Lockfile> =>
    JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const legacy = await readLock(source);
  const current = await readLock(installed);
  const workspaces: Array<{ path: string; directory: string }> = [];
  const sourceRoot = await realpath(source);
  for (const [path, entry] of Object.entries(legacy.packages)) {
    if (entry.link) {
      if (
        !/^node_modules\/@spinel\/[a-z0-9-]+$/.test(path) ||
        !/^lib\/[a-z0-9-]+$/.test(entry.resolved ?? '') ||
        !legacy.packages[entry.resolved!]
      )
        throw new Error(`Unsupported archived workspace link: ${path}`);
      const directory = join(sourceRoot, entry.resolved!);
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (
        manifest.name !== path.slice('node_modules/'.length) ||
        (await realpath(directory)) !== directory
      )
        throw new Error(`Archived workspace identity mismatch: ${path}`);
      workspaces.push({ path, directory });
    } else if (path.startsWith('node_modules/')) {
      if (!isDeepStrictEqual(entry, current.packages[path]))
        throw new Error(`Installed dependency differs from the archived lockfile: ${path}`);
    } else if (path && !/^lib\/[a-z0-9-]+$/.test(path)) {
      throw new Error(`Unsupported archived dependency layout: ${path}`);
    }
  }
  const archived = Object.keys(legacy.packages).filter((path) => path.startsWith('lib/'));
  const linked = new Set(workspaces.map(({ directory }) => directory));
  if (
    !archived.length ||
    linked.size !== workspaces.length ||
    archived.some((path) => !linked.has(join(sourceRoot, path)))
  )
    throw new Error('Every archived workspace must have its own dependency link.');

  const installedModules = join(installed, 'node_modules');
  const entries = await readdir(installedModules, { withFileTypes: true });
  const modules = join(sourceRoot, 'node_modules');
  // An existing directory or whole-tree link is an error, never an overwrite.
  await mkdir(modules);
  await mkdir(join(modules, '@spinel'));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '@spinel') continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    await symlink(join(installedModules, entry.name), join(modules, entry.name), 'dir');
  }
  for (const { path, directory } of workspaces)
    await symlink(directory, join(sourceRoot, path), 'dir');
}
