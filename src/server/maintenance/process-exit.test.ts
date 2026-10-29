import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  lstatSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));
vi.mock('node:fs', () => fs);
import { processResourcesReleased, waitForProcessInventory } from './process-exit.ts';

function stat(state = 'Z', threads = '1', start = '100') {
  const fields = Array<string>(20).fill('0');
  fields[0] = state;
  fields[17] = threads;
  fields[19] = start;
  return `42 (fixture with ) spaces) ${fields.join(' ')}\n`;
}
function error(code: string) {
  return Object.assign(new Error(code), { code });
}
beforeEach(() => {
  vi.resetAllMocks();
  fs.readFileSync.mockReturnValue(stat());
  fs.readdirSync.mockReturnValue(['42']);
  fs.lstatSync.mockReturnValue({});
});

test.each(['Z', 'X'])(
  'a stable terminal %s process with only its leader released resources',
  (state) => {
    fs.readFileSync.mockReturnValue(stat(state));
    expect(processResourcesReleased('42')).toBe(true);
    expect(fs.readFileSync).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync).toHaveBeenCalledWith('/proc/42/task');
  },
);

test('live or stopped processes are not released', () => {
  for (const state of ['R', 'S', 'D', 'T', 't', 'I']) {
    fs.readFileSync.mockReturnValue(stat(state));
    expect(processResourcesReleased('42')).toBe(false);
  }
});

test('an exited leader with live threads cannot be skipped', () => {
  fs.readFileSync.mockReturnValue(stat('Z', '2'));
  expect(processResourcesReleased('42')).toBe(false);
  fs.readFileSync.mockReturnValue(stat());
  fs.readdirSync.mockReturnValue(['42', '43']);
  expect(processResourcesReleased('42')).toBe(false);
  fs.readdirSync.mockReturnValue(['43']);
  expect(processResourcesReleased('42')).toBe(false);
});

test('PID reuse or state changes during the inventory remain inconclusive', () => {
  fs.readFileSync.mockReturnValueOnce(stat()).mockReturnValueOnce(stat('Z', '1', '101'));
  expect(processResourcesReleased('42')).toBe(false);
  fs.readFileSync.mockReturnValueOnce(stat()).mockReturnValueOnce(stat('S'));
  expect(processResourcesReleased('42')).toBe(false);
});

test('unreadable live candidates are not treated as closed', () => {
  fs.readFileSync.mockImplementation(() => {
    throw error('EACCES');
  });
  expect(processResourcesReleased('42')).toBe(false);
  expect(fs.lstatSync).not.toHaveBeenCalled();
});

test('a missing task directory does not establish that all threads exited', () => {
  fs.readdirSync.mockImplementation(() => {
    throw error('ENOENT');
  });
  expect(processResourcesReleased('42')).toBe(false);
  expect(fs.lstatSync).toHaveBeenCalledWith('/proc/42');
});

test.each(['ENOENT', 'ESRCH'])('a genuinely disappeared process is released (%s)', (code) => {
  fs.readFileSync.mockImplementation(() => {
    throw error(code);
  });
  fs.lstatSync.mockImplementation(() => {
    throw error(code);
  });
  expect(processResourcesReleased('42')).toBe(true);
});

test('unreadable disappearance verification remains closed', () => {
  fs.readFileSync.mockImplementation(() => {
    throw error('ENOENT');
  });
  fs.lstatSync.mockImplementation(() => {
    throw error('EACCES');
  });
  expect(processResourcesReleased('42')).toBe(false);
});

test('malformed process status and invalid PID paths are refused', () => {
  for (const value of ['garbled', '42 (fixture) Z', stat('Z', '1', 'not-a-number')]) {
    fs.readFileSync.mockReturnValue(value);
    expect(processResourcesReleased('42')).toBe(false);
  }
  fs.readFileSync.mockClear();
  for (const pid of ['0', '-1', '../self', '42/task/43', ''])
    expect(processResourcesReleased(pid)).toBe(false);
  expect(fs.readFileSync).not.toHaveBeenCalled();
});

// Fake timers make the safety deadline deterministic; the real supervisor
// suite separately exercises multithreaded exit and orphan WAL ownership.
afterEach(() => vi.useRealTimers());

test('permission retries require a fresh complete inventory, not an assumed exit', async () => {
  vi.useFakeTimers();
  const refused = error('EACCES');
  const read = vi
    .fn()
    .mockImplementationOnce(() => {
      throw refused;
    })
    .mockReturnValue([42]);
  const result = waitForProcessInventory(read, Date.now() + 100);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(25);
  expect(await result).toEqual([42]);
  expect(read).toHaveBeenCalledTimes(2);
});

test('persistently unreadable live owners remain blocked at the original deadline', async () => {
  vi.useFakeTimers();
  const refused = error('EACCES');
  const read = vi.fn(() => {
    throw refused;
  });
  const result = waitForProcessInventory(read, Date.now() + 60).catch(
    (failure: unknown) => failure,
  );
  await vi.advanceTimersByTimeAsync(60);
  expect(await result).toBe(refused);
  expect(read).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
});

test('a successful empty inventory is returned only after the complete read succeeds', async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockImplementationOnce(() => {
      throw error('EACCES');
    })
    .mockReturnValue([]);
  const result = waitForProcessInventory(read, Date.now() + 100);
  await vi.advanceTimersByTimeAsync(25);
  expect(await result).toEqual([]);
});

test('identity and nonpermission failures are never retried or translated', async () => {
  vi.useFakeTimers();
  for (const failure of [
    error('EPERM'),
    error('EIO'),
    new Error('Process group identity changed.'),
  ]) {
    const read = vi.fn(() => {
      throw failure;
    });
    await expect(waitForProcessInventory(read, Date.now() + 100)).rejects.toBe(failure);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  }
});

test('an elapsed deadline cannot be renewed by another permission failure', async () => {
  vi.useFakeTimers();
  const refused = error('EACCES');
  const read = vi.fn(() => {
    throw refused;
  });
  await expect(waitForProcessInventory(read, Date.now() - 1)).rejects.toBe(refused);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
