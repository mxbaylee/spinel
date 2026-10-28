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

interface Permit {
  gate: MaintenanceGate;
  active: boolean;
  epoch: string;
  release(): void;
}
const context = new AsyncLocalStorage<Permit>();

/** One admission follows actual work, including after a caller closes its socket. */
export class MaintenanceGate {
  private readonly bridge?: MaintenanceBridge;
  private readonly active = new Set<Permit>();
  private readonly waiters = new Set<() => void>();
  private lifecycle = false;
  private closed = false;
  private admissionClosed = false;
  constructor(bridge?: MaintenanceBridge) {
    this.bridge = bridge;
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
        const mcp = request.path === '/mcp' || request.path.startsWith('/mcp/');
        const oauth = /^\/(?:authorize|register|token|revoke)\/?$/.test(request.path);
        const epoch = request.get(MAINTENANCE_HEADER);
        if (mutation && !mcp && !oauth) this.assertEpoch(epoch);
        permit = this.begin(mutation && !mcp && !oauth ? epoch : undefined);
      } catch (error) {
        const failure = error instanceof MaintenanceError ? error : new MaintenanceError();
        response
          .status(failure.status)
          .set('Cache-Control', 'no-store')
          .set('Retry-After', '5')
          .json({ error: failure.message, code: failure.code, maintenance: this.status });
        return;
      }
      response.once('finish', permit.release);
      response.once('close', permit.release);
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
    if (response.writableFinished || response.destroyed) permit.release();
    else {
      response.once('finish', permit.release);
      response.once('close', permit.release);
    }
    return result;
  } catch (error) {
    permit.release();
    throw error;
  }
}
