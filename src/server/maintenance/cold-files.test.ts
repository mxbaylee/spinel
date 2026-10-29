import { linkSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { acquireColdWorkspace, acquireColdWorkspaceFiles } from './journal.ts';

test('batch cold ownership refuses source/target aliases and rolls back every initial reservation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-cold-files-'));
  const source = join(directory, 'source.sqlite');
  const target = join(directory, 'target.sqlite');
  const symbolic = join(directory, 'symbolic.sqlite');
  try {
    writeFileSync(source, 'Retained source');
    linkSync(source, target);
    symlinkSync(source, symbolic);
    await expect(acquireColdWorkspaceFiles([source, target])).rejects.toThrow('must not alias');
    await expect(acquireColdWorkspaceFiles([source, symbolic])).rejects.toThrow('distinct');
    for (const path of [source, target]) {
      const release = await acquireColdWorkspace(path);
      await release();
    }
    rmSync(target);
    const files = await acquireColdWorkspaceFiles([source, target]);
    try {
      linkSync(source, target);
      await expect(files.bindFile(target)).rejects.toThrow('must not alias');
    } finally {
      await files.release();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('batch cold ownership retains replaced inodes and follows an intentional rename without self-conflict', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-cold-replace-'));
  const copying = join(directory, 'copying.sqlite');
  const final = join(directory, 'final.sqlite');
  const oldAlias = join(directory, 'old-alias.sqlite');
  const newAlias = join(directory, 'new-alias.sqlite');
  writeFileSync(copying, 'Previous copy');
  linkSync(copying, oldAlias);
  const files = await acquireColdWorkspaceFiles([copying, final]);
  try {
    rmSync(copying);
    writeFileSync(copying, 'Replacement copy', { flag: 'wx' });
    await files.bindFile(copying);
    linkSync(copying, newAlias);
    renameSync(copying, final);
    await files.bindFile(final);
    for (const path of [copying, final, oldAlias, newAlias])
      await expect(acquireColdWorkspace(path)).rejects.toThrow('active supervisor');
  } finally {
    // No SQLite open occurs in this low-level fixture, so explicit release is safe.
    await files.release();
    rmSync(directory, { recursive: true, force: true });
  }
});
