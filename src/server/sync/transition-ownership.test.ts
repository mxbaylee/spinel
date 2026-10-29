import { fork } from 'node:child_process';
import { on, once } from 'node:events';
import { existsSync, linkSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { acquireColdWorkspace } from '../maintenance/journal.ts';

test('real transition files exclude competing aliases before SQLite opens, across replacements, renames and resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-transition-ownership-'));
  const child = fork(fileURLToPath(new URL('./transition-ownership-fixture.ts', import.meta.url)), {
    env: { ...process.env, SPINEL_TRANSITION_FIXTURE: directory },
    execArgv: ['--max-old-space-size=256'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr?.on('data', (value) => (stderr += String(value)));
  const exited = once(child, 'exit');
  const aliases = new Map<string, string>();
  const observed = new Set<string>();
  const emptyInodes = new Map<string, Set<string>>();
  const copiedInodes = new Map<string, Set<string>>();
  let exportInterruptions = 0;
  let importInterruptions = 0;
  let completed = false;
  let lastBoundary = 'startup';
  const refused = async (path: string) => {
    let release: (() => Promise<void>) | undefined;
    try {
      await expect(
        acquireColdWorkspace(path).then((value) => {
          release = value;
        }),
      ).rejects.toThrow('active supervisor');
    } finally {
      await release?.();
    }
  };
  const inspect = async (path: string) => {
    await refused(path);
    if (!existsSync(path)) return;
    const info = statSync(path, { bigint: true });
    const key = `${info.dev}:${info.ino}`;
    if (!aliases.has(key)) {
      const alias = join(directory, `hard-alias-${aliases.size}.sqlite`);
      const symbolic = join(directory, `symbolic-alias-${aliases.size}.sqlite`);
      linkSync(path, alias);
      symlinkSync(path, symbolic);
      aliases.set(key, alias);
      await refused(alias);
      await refused(symbolic);
    }
  };
  try {
    for await (const [value] of on(child, 'message', {
      signal: AbortSignal.timeout(20_000),
      close: ['exit'],
    })) {
      const message = value as {
        event: string;
        paths?: string[];
        path?: string;
        inode?: string;
        device?: string;
        size?: number;
        operation?: string;
      };
      lastBoundary = `${message.event}${message.path ? `: ${message.path}` : ''}`;
      if (message.event === 'reserved') {
        for (const path of message.paths!) await inspect(path);
      } else if (message.event === 'bound') {
        const path = message.path!;
        await inspect(path);
        observed.add(path);
        const inodes = message.size === 0 ? emptyInodes : copiedInodes;
        const identities = inodes.get(basename(path)) ?? new Set<string>();
        identities.add(`${message.device}:${message.inode}`);
        inodes.set(basename(path), identities);
      } else if (message.event === 'legacy-open') {
        await inspect(message.path!);
      } else if (message.event === 'interrupted') {
        if (message.operation === 'export') exportInterruptions++;
        else importInterruptions++;
        for (const alias of aliases.values()) await refused(alias);
      } else if (message.event === 'complete') {
        for (const alias of aliases.values()) await refused(alias);
        completed = true;
      } else throw new Error(`Unexpected fixture message: ${JSON.stringify(message)}`);
      child.send('continue');
      if (completed) break;
    }
    const [code] = await exited;
    expect(code, stderr).toBe(0);
    expect(completed).toBe(true);
    expect(exportInterruptions).toBe(3);
    expect(importInterruptions).toBe(2);
    expect([...observed].map((path) => basename(path)).sort()).toEqual(
      [
        'original.sqlite',
        'source.sqlite',
        'source-copying.sqlite',
        'legacy-working.sqlite',
        'sanitizing.sqlite',
        'metadata.sqlite',
        'pending-copying.sqlite',
        'pending.sqlite',
        'spinel.sqlite',
      ].sort(),
    );
    for (const name of [
      'source-copying.sqlite',
      'legacy-working.sqlite',
      'sanitizing.sqlite',
      'pending-copying.sqlite',
    ]) {
      // Proves pinned libsql VACUUM wrote the already-bound empty inode instead
      // of replacing it, and every interrupted staging generation was retained.
      expect(emptyInodes.get(name)?.size, name).toBe(2);
      expect(copiedInodes.get(name)?.size, name).toBeGreaterThan(0);
      for (const identity of copiedInodes.get(name)!)
        expect(emptyInodes.get(name)?.has(identity), name).toBe(true);
    }
    for (const alias of aliases.values()) {
      const release = await acquireColdWorkspace(alias);
      await release();
    }
  } catch (error) {
    throw new Error(`Transition fixture stopped at ${lastBoundary}.\n${stderr}`, { cause: error });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
