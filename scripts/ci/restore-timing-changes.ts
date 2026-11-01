import { appendFileSync, readFileSync } from 'node:fs';
import { changedPaths } from './changes.ts';

/** The expensive fixed-size restore follows its production runtime and browser
 * entry points. Unknown commit ranges run it; both sides of renames come from
 * changedPaths. Ordinary browser checks still cover unrelated UI changes. */
export function needsRestoreTiming(paths: readonly string[]): boolean {
  return (
    paths.length === 0 ||
    paths.some(
      (path) =>
        /^(?:server|src\/server|src\/shared|lib)\//.test(path) ||
        /^web\/(?:admin|Admin|Backup|backup-|auth|Auth|passkey|Passkey|maintenance|Maintenance|api\.)/.test(
          path,
        ) ||
        /^src\/ui\/redesign\/Controls\./.test(path) ||
        /^e2e\/(?:restore-|supervised-restore)/.test(path) ||
        /^e2e\/(?:doc-touch|native-sheet-value)\./.test(path) ||
        /^scripts\/ci\/(?:changes|restore-timing-changes|restore-observer|pid-namespace)/.test(
          path,
        ) ||
        /^scripts\/dependencies\//.test(path) ||
        /^scripts\/deploy\/maintenance\./.test(path) ||
        [
          'package.json',
          'package-lock.json',
          'Dockerfile',
          '.dockerignore',
          '.nvmrc',
          'vite.config.ts',
          'tsconfig.json',
        ].includes(path) ||
        path === '.github/workflows/ci.yml',
    )
  );
}

if (import.meta.main) {
  let run = true;
  try {
    run = needsRestoreTiming(
      changedPaths(
        process.env.GITHUB_EVENT_NAME ?? '',
        JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')),
      ),
    );
  } catch {
    console.log('Restore change range unavailable; sized acceptance is required.');
  }
  console.log(run ? 'Sized restore acceptance required.' : 'No restore timing dependency changed.');
  appendFileSync(process.env.GITHUB_OUTPUT!, `run=${run}\n`);
}
