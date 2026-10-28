import { lstatSync, readFileSync, readdirSync } from 'node:fs';

/** A zombie leader is not enough: a surviving thread can still own open files. */
export function processResourcesReleased(pid: string): boolean {
  if (!/^[1-9]\d*$/.test(pid)) return false;
  const path = `/proc/${pid}`;
  const read = () => {
    const stat = readFileSync(`${path}/stat`, 'utf8');
    const end = stat.lastIndexOf(') ');
    if (end < 0) throw new Error('Invalid process identity.');
    const fields = stat.slice(end + 2).trim().split(/\s+/);
    return { state: fields[0], threads: fields[17], start: fields[19] };
  };
  const terminal = (state: ReturnType<typeof read>) =>
    (state.state === 'Z' || state.state === 'X') &&
    state.threads === '1' &&
    /^\d+$/.test(state.start ?? '');
  try {
    const before = read();
    if (!terminal(before)) return false;
    const tasks = readdirSync(`${path}/task`);
    if (tasks.length !== 1 || tasks[0] !== pid) return false;
    const after = read();
    return terminal(after) && before.start === after.start;
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    // A missing task directory alone does not prove that every thread exited.
    try {
      lstatSync(path);
      return false;
    } catch (missing) {
      return ['ENOENT', 'ESRCH'].includes((missing as NodeJS.ErrnoException).code ?? '');
    }
  }
}
