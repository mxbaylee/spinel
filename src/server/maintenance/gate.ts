import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler, Response } from 'express';
import type { MaintenanceBridge, MaintenancePublicStatus } from '../../shared/maintenance.ts';

export const MAINTENANCE_HEADER = 'X-Spinel-Epoch';
export class MaintenanceError extends Error {
  readonly status: number;
  readonly code: 'maintenance' | 'maintenance-epoch';
  constructor(stale = false) {
    super(
      stale
        ? 'Maintenance changed this workspace. Keep pending work and reload before making new changes.'
        : 'Edits are paused for maintenance. Keep this page open until the workspace resumes.',
    );
    this.status = stale ? 409 : 503;
    this.code = stale ? 'maintenance-epoch' : 'maintenance';
  }
}

/** Long work stopped because the application is shutting down, not paused. */
export class ShutdownError extends Error {
  constructor() {
    super('The application is restarting. Try again shortly.');
  }
}

interface Permit {
  gate: MaintenanceGate;
  active: boolean;
  epoch: string;
  release(): void;
}
const context = new AsyncLocalStorage<Permit>();
const responseReleases = new WeakMap<Response, Set<() => void>>();

/** Callback middleware shares one response cleanup pair. Async route work keeps
 * its separate promise-owned permit beyond response close. */
function releaseWithResponse(response: Response, release: () => void) {
  if (response.writableFinished || response.destroyed) {
    release();
    return;
  }
  let releases = responseReleases.get(response);
  if (!releases) {
    releases = new Set();
    responseReleases.set(response, releases);
    const finished = () => {
      response.off('finish', finished);
      response.off('close', finished);
      responseReleases.delete(response);
      for (const done of releases!) done();
      releases!.clear();
    };
    response.once('finish', finished);
    response.once('close', finished);
  }
  releases.add(release);
}

/** One admission follows actual work, including after a caller closes its socket. */
export class MaintenanceGate {
  private readonly bridge?: MaintenanceBridge;
  private readonly active = new Set<Permit>();
  private readonly waiters = new Set<() => void>();
  private readonly cancellable = new Set<AbortController>();
  /** Shutdown is terminal, so work registered after it reports a restart. */
  private shutdown = false;
  private lifecycle = false;
  private closed = false;
  private admissionClosed = false;
  private readonly blocked?: () => boolean;
  constructor(bridge?: MaintenanceBridge, blocked?: () => boolean) {
    this.bridge = bridge;
    this.blocked = blocked;
  }
  get status(): MaintenancePublicStatus {
    return this.bridge?.status() ?? { available: false, phase: 'running', epoch: '', notice: null };
  }
  get pending() {
    return this.active.size;
  }
  get epoch() {
    const permit = context.getStore();
    return permit?.gate === this && permit.active ? permit.epoch : this.status.epoch;
  }
  get running() {
    return (
      !this.closed &&
      !this.admissionClosed &&
      !this.blocked?.() &&
      (!this.status.available || this.status.phase === 'running')
    );
  }
  assertEpoch(epoch: unknown) {
    if (this.status.available && epoch !== this.epoch) throw new MaintenanceError(true);
  }
  begin(epoch?: string): Permit {
    const parent = context.getStore();
    if (this.status.available && parent?.gate === this && !parent.active)
      throw new MaintenanceError(true);
    const inherited = parent?.gate === this && parent.active;
    if (!inherited) {
      if (!this.running) throw new MaintenanceError();
      if (epoch !== undefined) this.assertEpoch(epoch);
    }
    const permit: Permit = {
      gate: this,
      active: true,
      epoch: inherited ? parent.epoch : this.status.epoch,
      release: () => {
        if (!permit.active) return;
        permit.active = false;
        this.active.delete(permit);
        if (!this.active.size) for (const done of this.waiters) done();
      },
    };
    this.active.add(permit);
    return permit;
  }
  within<T>(permit: Permit, work: () => T): T {
    if (permit.gate !== this || !permit.active) throw new MaintenanceError();
    return context.run(permit, work);
  }
  run<T>(work: () => T, epoch?: string): T {
    const permit = this.begin(epoch);
    try {
      const result = this.within(permit, work);
      if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function')
        return Promise.resolve(result).finally(permit.release) as T;
      permit.release();
      return result;
    } catch (error) {
      permit.release();
      throw error;
    }
  }
  /** Timer invocations have no request authority; skipped jobs retain their due work. */
  job<T>(work: () => T): T | undefined {
    if (!this.running) return undefined;
    return context.exit(() => this.run(work));
  }
  assertWrite() {
    if (this.blocked?.() && !this.lifecycle) throw new MaintenanceError();
    if (!this.status.available) return;
    if (this.lifecycle) return;
    const permit = context.getStore();
    if (!permit || permit.gate !== this || !permit.active || this.closed)
      throw new MaintenanceError();
  }
  /** Private synchronous flush/initialization only; never wraps an HTTP action. */
  initialize<T>(work: () => T): T {
    const previous = this.lifecycle;
    this.lifecycle = true;
    try {
      const result = work();
      if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function')
        throw new Error('Maintenance initialization must be synchronous.');
      return result;
    } finally {
      this.lifecycle = previous;
    }
  }
  async drain(deadlineMs = 25_000) {
    if (!this.active.size) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        reject(new Error('Maintenance drain deadline exceeded.'));
      }, deadlineMs);
      this.waiters.add(done);
    });
  }
  /**
   * Long transfers and preparations can outlast the drain deadline. They abort
   * when draining starts and report an ordinary cancellation, instead of
   * holding admission until the pause fails into recovery-required.
   */
  cancelOnDrain(controller: AbortController): () => void {
    if (!this.running)
      controller.abort(this.shutdown ? new ShutdownError() : new MaintenanceError());
    else this.cancellable.add(controller);
    return () => this.cancellable.delete(controller);
  }
  cancelLongWork(reason: Error = new MaintenanceError()) {
    if (reason instanceof ShutdownError) this.shutdown = true;
    for (const controller of this.cancellable) controller.abort(reason);
    this.cancellable.clear();
  }
  stop() {
    this.closed = true;
  }
  stopAdmission() {
    this.admissionClosed = true;
  }
  middleware(): RequestHandler {
    return (request, response, next) => {
      // Status and Operator control are mounted before this admission boundary.
      let permit: Permit;
      try {
        const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
        // MCP carries the observed epoch inside each edit's arguments, rather
        // than requiring an extra nonstandard header from every MCP client.
        // Express routes match paths case-insensitively; so must admission.
        const mcp = /^\/mcp(?:\/|$)/i.test(request.path);
        const oauth = /^\/(?:authorize|register|token|revoke)\/?$/i.test(request.path);
        // A native browser form cannot set an epoch header. This one route
        // validates its single-use capability's admitted epoch before claim or
        // any write; its authorization POST still requires the normal header.
        const backupDownload =
          request.method === 'POST' &&
          /^\/api\/admin\/backups\/exports\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/file\/?$/i.test(
            request.path,
          );
        const epochRequired = mutation && !mcp && !oauth && !backupDownload;
        const epoch = request.get(MAINTENANCE_HEADER);
        if (epochRequired) this.assertEpoch(epoch);
        permit = this.begin(epochRequired ? epoch : undefined);
      } catch (error) {
        const failure = error instanceof MaintenanceError ? error : new MaintenanceError();
        response
          .status(failure.status)
          .set('Cache-Control', 'no-store')
          .set('Retry-After', '5')
          .json({ error: failure.message, code: failure.code, maintenance: this.status });
        return;
      }
      releaseWithResponse(response, permit.release);
      if (this.status.available) response.set(MAINTENANCE_HEADER, permit.epoch);
      this.within(permit, next);
    };
  }
}

/** Route wrappers keep a separate lease until their returned promise settles. */
export function trackMaintenanceWork<T>(work: () => T, response: Response): T {
  const parent = context.getStore();
  if (!parent) return work();
  const permit = parent.gate.begin();
  try {
    const result = parent.gate.within(permit, work);
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function')
      return Promise.resolve(result).finally(permit.release) as T;
    // Callback middleware (including Express's body parser) returns before it
    // calls next(). Keep its inherited context valid while that request lives.
    releaseWithResponse(response, permit.release);
    return result;
  } catch (error) {
    permit.release();
    throw error;
  }
}
