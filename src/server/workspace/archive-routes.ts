import { maintenanceRouter } from '../maintenance/router.ts';
import express from 'express';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import {
  extendArchiveBodyDeadline,
  ARCHIVE_TRANSFER_TIMEOUT as TRANSFER_TIMEOUT,
} from '../../../server/http.ts';
import { ARCHIVE_LIMIT } from '../../shared/archive.ts';
import type { ArchiveTask } from '../../shared/archive.ts';
import { AuthError } from '../auth/store.ts';
import { documentIdentity } from '../collaboration/identity.ts';
import { WorkspaceArchive } from './archive.ts';
import type { PortableFiles } from './portable.ts';
import type { WorkspaceStore } from './store.ts';
import { admitTransfer, transfers } from './transfers.ts';
import { archiveCapacity, archiveDirectory } from './archive-storage.ts';

const TASK_TTL = 15 * 60_000;
const MAX_TASKS = 100;
type Task = {
  public: ArchiveTask;
  user: string;
  sessionHash: string;
  controller: AbortController;
  working: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** Small, short-lived download receipts. Archive content never lives in this map. */
export function archiveRoutes(workspace: WorkspaceStore, files: PortableFiles) {
  const router = maintenanceRouter();
  const tasks = new Map<string, Task>();
  const identity = (request: Request) => {
    const current = documentIdentity(workspace, request.headers);
    const sessionHash =
      'sessionHash' in current.customData ? current.customData.sessionHash : undefined;
    if (typeof sessionHash !== 'string') throw new AuthError(401, 'Sign in to continue.');
    return { ...current, sessionHash };
  };
  const arm = (task: Task, delay = TASK_TTL) => {
    clearTimeout(task.timer);
    task.timer = setTimeout(() => {
      task.controller.abort();
      task.public.state = 'cancelled';
      // Running work still owns admission and its receipt until it settles.
      if (!task.working) tasks.delete(task.public.id);
    }, delay);
    task.timer.unref();
  };
  const lookup = (request: Request) => {
    const current = identity(request);
    const task = tasks.get(String(request.params.taskId));
    if (!task || task.user !== current.userId || task.sessionHash !== current.sessionHash)
      throw new AuthError(404, 'This archive task is no longer available.');
    return { task, current };
  };

  router.post(
    '/archive-export',
    express.json({ limit: '1kb', strict: true }),
    (request, response) => {
      if (request.body && Object.keys(request.body).length)
        throw new AuthError(400, 'Export all your owned files without additional settings.');
      const current = identity(request);
      for (const task of tasks.values()) {
        if (task.user !== current.userId) continue;
        // A lost creation response can be retried without stranding this account.
        if (task.public.state === 'ready' && task.sessionHash === current.sessionHash) {
          response.status(201).json({ task: task.public });
          return;
        }
        if (task.working || task.public.state === 'ready')
          throw new AuthError(
            429,
            'Your other archive export is still running. Try again shortly.',
          );
        clearTimeout(task.timer);
        tasks.delete(task.public.id);
      }
      if (tasks.size >= MAX_TASKS)
        throw new AuthError(429, 'Archive exports are busy. Try again shortly.');
      const id = randomUUID();
      const task: Task = {
        public: {
          id,
          state: 'ready',
          completed: 0,
          total: null,
          downloadUrl: `/api/items/archive-export/${id}/download`,
        },
        user: current.userId,
        sessionHash: current.sessionHash,
        controller: new AbortController(),
        working: false,
      };
      tasks.set(id, task);
      arm(task);
      response.status(201).json({ task: task.public });
    },
  );
  router.get('/archive-export/:taskId', (request, response) => {
    response.json({ task: lookup(request).task.public });
  });
  router.delete('/archive-export/:taskId', (request, response) => {
    const { task } = lookup(request);
    if (task.public.state === 'ready' || task.public.state === 'exporting') {
      task.controller.abort();
      task.public.state = 'cancelled';
      arm(task);
    }
    response.json({ task: task.public });
  });
  router.get('/archive-export/:taskId/download', async (request, response) => {
    const { task, current } = lookup(request);
    if (task.public.state !== 'ready')
      throw new AuthError(409, 'Start a new export to download another archive.');
    task.public.state = 'exporting';
    task.working = true;
    arm(task, TRANSFER_TIMEOUT);
    const closed = () => {
      if (!response.writableFinished) task.controller.abort();
    };
    response.once('close', closed);
    // A multi-gigabyte download must not hold a maintenance drain open.
    const releaseDrain = workspace.auth.database.maintenance?.cancelOnDrain(task.controller);
    const verify = () => {
      const fresh = identity(request);
      if (
        fresh.userId !== task.user ||
        fresh.sessionHash !== task.sessionHash ||
        task.controller.signal.aborted ||
        response.destroyed
      )
        throw new AuthError(409, 'Export stopped. Start a new export when you are ready.');
    };
    try {
      // Catch admission rejection here so the polling UI sees a terminal failure.
      admitTransfer(request, response, () => {});
      transfers.get(response)!.start();
      const archive = new WorkspaceArchive(workspace, files, current.customData);
      response
        .attachment(`Spinel-files-${new Date().toISOString().slice(0, 10)}.zip`)
        .type('application/zip')
        .set('X-Content-Type-Options', 'nosniff');
      let bytes = 0;
      for await (const chunk of archive.export(task.user, verify, (progress) => {
        task.public.completed = progress.completed;
        task.public.total = progress.total;
      })) {
        verify();
        bytes += chunk.length;
        if (bytes > ARCHIVE_LIMIT)
          throw new AuthError(413, 'This archive exceeds the 8 GiB download limit.');
        if (!response.write(chunk))
          await once(response, 'drain', { signal: task.controller.signal });
      }
      verify();
      const completion = finished(response, { cleanup: true });
      response.end();
      await completion;
      if (!task.controller.signal.aborted) task.public.state = 'completed';
    } catch (error) {
      if (task.controller.signal.aborted) task.public.state = 'cancelled';
      else {
        task.public.state = 'failed';
        task.public.error =
          error instanceof AuthError ? error.message : 'Could not export your files. Try again.';
      }
      if (response.headersSent || response.destroyed) response.destroy();
      else {
        response.removeHeader('Content-Disposition');
        response.status(error instanceof AuthError ? error.status : 400).json({
          error: task.public.error ?? 'Export cancelled.',
        });
      }
    } finally {
      releaseDrain?.();
      task.working = false;
      transfers.get(response)?.finish();
      response.off('close', closed);
      arm(task);
    }
  });

  router.post('/archive-import', admitTransfer, async (request, response) => {
    const transfer = transfers.get(response)!;
    transfer.start();
    const controller = new AbortController();
    // Aborting must wake a stalled request read, not just its next verification.
    const stopUpload = () => {
      if (!request.complete) request.destroy();
    };
    controller.signal.addEventListener('abort', stopUpload, { once: true });
    const timer = setTimeout(() => controller.abort(), TRANSFER_TIMEOUT);
    timer.unref();
    const closed = () => {
      if (!response.writableFinished) controller.abort();
    };
    response.once('close', closed);
    const releaseDrain = workspace.auth.database.maintenance?.cancelOnDrain(controller);
    let directory: string | undefined;
    const cleanup = async () => {
      const path = directory;
      directory = undefined;
      if (!path) return;
      try {
        await rm(path, { recursive: true, force: true });
      } catch {
        // Never replace a successful publication with a false rollback response.
        console.error('Could not remove temporary archive storage; check the private data volume.');
      }
    };
    try {
      if (!request.is('application/zip'))
        throw new AuthError(415, 'Upload a ZIP archive from My files.');
      if (Object.keys(request.query).length)
        throw new AuthError(400, 'Import an archive into the root of My files.');
      if (
        (request.headers['content-encoding'] &&
          request.headers['content-encoding'] !== 'identity') ||
        Number(request.headers['content-length'] ?? 0) > ARCHIVE_LIMIT
      )
        throw new AuthError(413, 'Choose a ZIP archive no larger than 8 GiB.');
      const current = identity(request);
      extendArchiveBodyDeadline(request);
      const verify = () => {
        const fresh = identity(request);
        if (
          fresh.userId !== current.userId ||
          fresh.sessionHash !== current.sessionHash ||
          controller.signal.aborted ||
          request.aborted ||
          response.destroyed
        )
          throw new AuthError(409, 'Import stopped. No files were added.');
      };
      directory = await archiveDirectory(workspace.auth.database);
      await archiveCapacity(directory, Number(request.headers['content-length'] ?? 0));
      const path = join(directory, 'archive.zip');
      const file = await open(path, 'wx', 0o600);
      let bytes = 0;
      let checked = 0;
      try {
        // Opt out of iterator auto-destroy so a rejected upload can receive JSON.
        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
          verify();
          bytes += chunk.length;
          if (bytes > ARCHIVE_LIMIT)
            throw new AuthError(413, 'Choose a ZIP archive no larger than 8 GiB.');
          if (bytes - checked >= 8 * 1024 * 1024) {
            await archiveCapacity(directory, chunk.length);
            checked = bytes;
          }
          let offset = 0;
          while (offset < chunk.length) {
            const result = await file.write(chunk, offset, chunk.length - offset);
            offset += result.bytesWritten;
          }
        }
      } finally {
        await file.close();
      }
      verify();
      const result = await new WorkspaceArchive(workspace, files, current.customData).import(
        current.userId,
        path,
        verify,
      );
      await cleanup();
      response.status(201).json({ result });
    } catch (error) {
      await cleanup();
      if (!response.destroyed) {
        // Do not continue receiving a rejected multi-gigabyte upload.
        if (!request.complete) response.set('Connection', 'close');
        response.status(error instanceof AuthError ? error.status : 400).json({
          error:
            error instanceof AuthError
              ? error.message
              : 'Could not import this archive. No files were added.',
        });
      }
    } finally {
      releaseDrain?.();
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', stopUpload);
      response.off('close', closed);
      try {
        await cleanup();
      } finally {
        transfer.finish();
      }
    }
  });
  return router;
}
