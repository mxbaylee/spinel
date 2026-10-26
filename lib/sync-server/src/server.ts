import { observeSync } from '@spinel/diagnostics';
import type { SyncDropRule, SyncObservation } from '@spinel/diagnostics';
import {
  MalformedEditError,
  RefusedEditError,
  UnsupportedMutationError,
  transform,
} from '@spinel/sync-transform';
import type { Mutation } from '@spinel/sync-transform';
import { cellsAt, changes, digest, hashTouched } from './cells.ts';
import { InvariantError, NativeModel } from './native.ts';
import { applySheetOrder, sheetOrderAt } from './order.ts';
import {
  MAX_BATCH_MUTATIONS,
  MAX_RETAINED_REVISIONS,
  MAX_SNAPSHOT_BYTES,
  MAX_WORKSHEETS,
  SyncError,
} from './types.ts';
import type {
  SubmitRequest,
  SubmitResult,
  SyncOptions,
  SyncRevision,
  SyncStorage,
  SyncUnit,
} from './types.ts';

interface Cached {
  revision: number;
  model: NativeModel;
  touchedAt: number;
}

/** Document data is untrusted even when its sender is an authorized editor. */
function validateRequest(request: SubmitRequest) {
  if (
    !request ||
    typeof request !== 'object' ||
    typeof request.unitId !== 'string' ||
    !request.unitId ||
    request.unitId.length > 128 ||
    typeof request.actorId !== 'string' ||
    !request.actorId ||
    request.actorId.length > 256 ||
    typeof request.mutationId !== 'string' ||
    !/^[A-Za-z0-9:_-]{1,128}$/.test(request.mutationId) ||
    !Number.isSafeInteger(request.baseRevision) ||
    request.baseRevision < 1 ||
    !Array.isArray(request.mutations) ||
    request.mutations.length > MAX_BATCH_MUTATIONS ||
    (request.exactRevision !== undefined && typeof request.exactRevision !== 'boolean')
  )
    throw new SyncError('malformed');
  const bytes = JSON.stringify(request);
  if (Buffer.byteLength(bytes) > MAX_SNAPSHOT_BYTES) throw new SyncError('capacity');
  let nodes = 0;
  let rangeCells = 0;
  const coordinate = (value: unknown, maximum: number, minimum = 0) => {
    if (!Number.isSafeInteger(value) || (value as number) < minimum)
      throw new SyncError('malformed');
    if ((value as number) > maximum) throw new SyncError('capacity');
    return value as number;
  };
  const rangeField = (path: string[]) =>
    /^(range|sourceRange|targetRange|fromRange|toRange)$/.test(path.at(-1) ?? '') ||
    path.at(-2) === 'ranges';
  const walk = (value: unknown, path: string[], allowedUnit: string, frozenRoot = false) => {
    if (++nodes > 500_000 || path.length > 64) throw new SyncError('capacity');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new SyncError('malformed');
    if (rangeField(path) && (!value || typeof value !== 'object' || Array.isArray(value)))
      throw new SyncError('malformed');
    if (path.at(-1) === 'ranges' && !Array.isArray(value)) throw new SyncError('malformed');
    if (value === null || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    // Native worksheet defaults and cancel-freeze mutations use -1 anchors.
    // Only this bounded configuration accepts them; ordinary ranges stay strict.
    const frozen = frozenRoot || path.at(-1) === 'freeze';
    if (frozen) {
      coordinate(data.startRow, 1_048_575, -1);
      coordinate(data.startColumn, 16_383, -1);
      coordinate(data.ySplit, 1_048_575);
      coordinate(data.xSplit, 16_383);
    }
    const mapLimit = ['rowData', 'rowInfo', 'rowHeight', 'autoHeightInfo'].includes(
      path.at(-1) ?? '',
    )
      ? 1_048_575
      : ['columnData', 'colInfo', 'colWidth'].includes(path.at(-1) ?? '')
        ? 16_383
        : undefined;
    if (mapLimit !== undefined) {
      if (Array.isArray(value)) throw new SyncError('malformed');
      for (const index of Object.keys(data)) {
        if (!/^\d+$/.test(index)) throw new SyncError('malformed');
        coordinate(+index, mapLimit);
      }
    }
    if (
      path.at(-1) === 'cellValue' ||
      path.at(-1) === 'cellData' ||
      (path.at(-1) === 'value' && ['from', 'to'].includes(path.at(-2) ?? ''))
    ) {
      for (const [row, columns] of Object.entries(data)) {
        if (
          !/^\d+$/.test(row) ||
          !Number.isSafeInteger(+row) ||
          +row > 1_048_575 ||
          !columns ||
          typeof columns !== 'object' ||
          Array.isArray(columns)
        )
          throw new SyncError('malformed');
        for (const column of Object.keys(columns))
          if (!/^\d+$/.test(column) || !Number.isSafeInteger(+column) || +column > 16_383)
            throw new SyncError('malformed');
      }
    }
    // Sheet rich text owns an embedded Doc identity, just as at the old boundary.
    if (
      path.length >= 3 &&
      path.at(-1) === 'p' &&
      path.slice(-3, -1).every((part) => /^\d+$/.test(part))
    ) {
      if (typeof data.id === 'string' && data.id) allowedUnit = data.id;
    }
    if (rangeField(path) || ('endRow' in data && 'endColumn' in data)) {
      let axes = 0;
      let area = 1;
      for (const [start, end, maximum] of [
        ['startRow', 'endRow', 1_048_575],
        ['startColumn', 'endColumn', 16_383],
      ] as const) {
        if (!(start in data) && !(end in data)) continue;
        const first = coordinate(data[start], maximum);
        const last = coordinate(data[end], maximum);
        if (last < first) throw new SyncError('malformed');
        axes++;
        area *= last - first + 1;
      }
      if (!axes) throw new SyncError('malformed');
      rangeCells += area;
      if (rangeCells > 250_000) throw new SyncError('capacity');
    }
    for (const [field, child] of Object.entries(data)) {
      if (['__proto__', 'prototype', 'constructor'].includes(field))
        throw new SyncError('malformed');
      if ((field === 'unitId' || field === 'unitID') && child !== allowedUnit)
        throw new SyncError('malformed');
      if (field === 'rowCount') coordinate(child, 1_048_576, 1);
      if (field === 'columnCount') coordinate(child, 16_384, 1);
      if (['startRow', 'endRow'].includes(field))
        coordinate(child, 1_048_575, frozen && field === 'startRow' ? -1 : 0);
      if (['startColumn', 'endColumn'].includes(field))
        coordinate(child, 16_383, frozen && field === 'startColumn' ? -1 : 0);
      if (path.at(-2) === 'rowsAutoHeightInfo' && field === 'row') coordinate(child, 1_048_575);
      walk(child, [...path, field], allowedUnit);
    }
  };
  for (const mutation of request.mutations) {
    if (
      !mutation ||
      typeof mutation.id !== 'string' ||
      !mutation.params ||
      typeof mutation.params !== 'object' ||
      Array.isArray(mutation.params) ||
      mutation.params.unitId !== request.unitId
    )
      throw new SyncError('malformed');
    const p = mutation.params;
    if (
      mutation.id === 'sheet.mutation.insert-sheet' ||
      mutation.id === 'sheet.mutation.remove-sheet'
    )
      coordinate(p.index, MAX_WORKSHEETS);
    if (mutation.id === 'sheet.mutation.set-worksheet-order') {
      coordinate(p.fromOrder, MAX_WORKSHEETS);
      coordinate(p.toOrder, MAX_WORKSHEETS);
    }
    if (mutation.id === 'sheet.mutation.set-worksheet-row-count')
      coordinate(p.rowCount, 1_048_576, 1);
    if (mutation.id === 'sheet.mutation.set-worksheet-column-count')
      coordinate(p.columnCount, 16_384, 1);
    if (
      [
        'sheet.mutation.insert-row',
        'sheet.mutation.insert-col',
        'sheet.mutation.remove-rows',
        'sheet.mutation.remove-col',
      ].includes(mutation.id) &&
      !p.range
    )
      throw new SyncError('malformed');
    if (
      ['sheet.mutation.move-rows', 'sheet.mutation.move-columns'].includes(mutation.id) &&
      (!p.sourceRange || !p.targetRange)
    )
      throw new SyncError('malformed');
    if (
      [
        'sheet.mutation.set-row-hidden',
        'sheet.mutation.set-row-visible',
        'sheet.mutation.set-col-hidden',
        'sheet.mutation.set-col-visible',
        'sheet.mutation.set-worksheet-row-height',
        'sheet.mutation.set-worksheet-row-is-auto-height',
        'sheet.mutation.set-worksheet-col-width',
        'sheet.mutation.add-worksheet-merge',
        'sheet.mutation.remove-worksheet-merge',
        'sheet.mutation.remove.numfmt',
      ].includes(mutation.id) &&
      !Array.isArray(p.ranges)
    )
      throw new SyncError('malformed');
    if (mutation.id === 'sheet.mutation.set-drawing-apply') {
      // Drawing JSON1 addresses a global unit-keyed tree. A forged path has no
      // unitId field for the generic walk to find, so fence its root explicitly.
      const scoped = (op: unknown): boolean =>
        op === null ||
        (Array.isArray(op) &&
          (op.length === 0 ||
            (typeof op[0] === 'string'
              ? op[0] === request.unitId
              : op.every((branch) => Array.isArray(branch) && scoped(branch)))));
      if (!scoped(mutation.params.op)) throw new SyncError('malformed');
    }
    walk(mutation.params, [], request.unitId, mutation.id === 'sheet.mutation.set-frozen');
  }
}

/** Storage-independent ordering. Only the adapter's guarded transaction acknowledges edits. */
export class SyncServer<Context = unknown> {
  private readonly storage: SyncStorage;
  private readonly options: SyncOptions<Context>;
  private readonly cache = new Map<string, Cached>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly maxLoadedUnits: number;
  private readonly idleTimeoutMs: number;
  private pending = 0;
  private closed = false;

  constructor(storage: SyncStorage, options: SyncOptions<Context>) {
    this.storage = storage;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.maxLoadedUnits = options.maxLoadedUnits ?? 8;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    if (
      !Number.isSafeInteger(this.maxLoadedUnits) ||
      this.maxLoadedUnits < 1 ||
      this.maxLoadedUnits > 8 ||
      !Number.isFinite(this.idleTimeoutMs) ||
      this.idleTimeoutMs < 1
    )
      throw new TypeError('Invalid sync cache limits.');
    this.timer = setInterval(() => this.evictIdle(), Math.min(this.idleTimeoutMs, 10_000));
    this.timer.unref();
  }

  private observe(context: Context, unitId: string, observation: SyncObservation) {
    try {
      observeSync(
        this.options.diagnosticsFor?.(context) ?? this.options.diagnostics,
        this.options.diagnosticContext?.(unitId, context) ?? { component: 'server' },
        observation,
      );
    } catch {
      /* Optional observers never change edit delivery. */
    }
  }

  private evictIdle() {
    const now = this.now();
    for (const [id, cached] of this.cache)
      if (now - cached.touchedAt >= this.idleTimeoutMs) this.invalidate(id);
  }

  invalidate(unitId: string) {
    const cached = this.cache.get(unitId);
    this.cache.delete(unitId);
    cached?.model.dispose();
  }

  private unit(unitId: string): SyncUnit {
    const unit = this.storage.load(unitId);
    if (!unit) throw new SyncError('unavailable');
    return unit;
  }

  private native(unit: SyncUnit) {
    this.evictIdle();
    const existing = this.cache.get(unit.unitId);
    if (existing?.revision === unit.revision) {
      existing.touchedAt = this.now();
      return existing.model;
    }
    this.invalidate(unit.unitId);
    while (this.cache.size >= this.maxLoadedUnits) {
      const oldest = [...this.cache].sort(([, a], [, b]) => a.touchedAt - b.touchedAt)[0];
      this.invalidate(oldest[0]);
    }
    const model = new NativeModel(unit.snapshot, unit.kind);
    this.cache.set(unit.unitId, { revision: unit.revision, model, touchedAt: this.now() });
    return model;
  }

  load(unitId: string, context: Context): SyncUnit {
    if (this.closed) throw new SyncError('unavailable');
    this.options.authorize(unitId, context, false);
    const unit = this.unit(unitId);
    const snapshot = this.native(unit).snapshot();
    snapshot.rev = unit.revision;
    this.options.validateSnapshot?.(unitId, snapshot, context);
    this.options.authorize(unitId, context, false);
    return { ...unit, snapshot };
  }

  /** An old receipt remains valid after reconnect, restart and before-image pruning. */
  submit(input: SubmitRequest, context: Context): Promise<SubmitResult> {
    if (this.closed) return Promise.reject(new SyncError('unavailable'));
    try {
      validateRequest(input);
    } catch (error) {
      this.observe(context, input?.unitId ?? '', { name: 'sync.edit.malformed', check: 'other' });
      return Promise.reject(error instanceof SyncError ? error : new SyncError('malformed'));
    }
    if (this.pending >= 64) return Promise.reject(new SyncError('capacity'));
    const request = structuredClone(input);
    this.pending++;
    const previous = this.queues.get(request.unitId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.submitOne(request, context));
    this.queues.set(request.unitId, run);
    void run
      .finally(() => {
        this.pending--;
        if (this.queues.get(request.unitId) === run) this.queues.delete(request.unitId);
      })
      .catch(() => {});
    return run;
  }

  private async submitOne(request: SubmitRequest, context: Context): Promise<SubmitResult> {
    const { unitId } = request;
    this.options.authorize(unitId, context, true);
    await this.options.beforeSubmit?.(unitId, context);
    // No await follows this scan: candidate validation and guarded durable write
    // form one event-loop turn. The storage adapter repeats authorization in SQL.
    this.options.authorize(unitId, context, true);
    const unit = this.unit(unitId);
    const requestHash = digest(request);
    const receipt = this.storage.receipt(unitId, request.actorId, request.mutationId);
    if (receipt) {
      if (receipt.requestHash !== requestHash) throw new SyncError('retry-conflict');
      return {
        duplicate: true,
        edit: receipt,
        missing:
          request.baseRevision >= unit.retainedFrom
            ? this.storage.revisions(unitId, request.baseRevision, receipt.revision)
            : [],
      };
    }
    if (
      request.baseRevision < unit.retainedFrom ||
      request.baseRevision > unit.revision ||
      unit.revision - request.baseRevision > MAX_RETAINED_REVISIONS ||
      (request.exactRevision && request.baseRevision !== unit.revision)
    )
      throw new SyncError('stale');
    const history = this.storage.revisions(unitId, request.baseRevision, unit.revision);
    if (
      history.length !== unit.revision - request.baseRevision ||
      history.some(
        (entry, index) =>
          entry.revision !== request.baseRevision + index + 1 ||
          entry.unitId !== unitId ||
          entry.beforeCells === null,
      )
    )
      throw new SyncError('stale');
    let mutations = request.mutations;
    const dropped = new Map<SyncDropRule, number>();
    let offsets = 0;
    const transformPast = (other: Mutation[], revision: number) => {
      // Check every intermediate rebase before it can feed the next axis model.
      // Positional metadata is proven on this pair's exact common base.
      validateRequest({ ...request, mutations });
      if (unit.kind === 'sheet') applySheetOrder(sheetOrderAt(unit, revision, history), mutations);
      const started = performance.now();
      this.observe(context, unitId, { name: 'sync.edit.transformed' });
      this.observe(context, unitId, { name: 'sync.transform.concurrent', value: other.length });
      try {
        return transform(mutations, other, 'right', {
          cells: cellsAt(unit, revision, history),
          observe: (event) => {
            if (event.kind === 'dropped')
              dropped.set(event.rule, (dropped.get(event.rule) ?? 0) + event.value);
            else if (event.kind === 'offset') offsets += event.value;
            else
              this.observe(context, unitId, { name: 'sync.transform.growth', value: event.value });
          },
        });
      } finally {
        this.observe(context, unitId, {
          name: 'sync.transform.duration',
          value: performance.now() - started,
        });
      }
    };
    try {
      // Even a current-head batch must pass the transform's sender admission.
      if (!history.length) mutations = transformPast([], unit.revision);
      else
        for (const prior of history) mutations = transformPast(prior.mutations, prior.revision - 1);
      // Transformation may expand a batch. Bound its replay cost and recheck
      // document targets before handing it to the native command registry.
      validateRequest({ ...request, mutations });
      const native = this.native(unit);
      const before = native.snapshot();
      const snapshot = native.apply(mutations);
      if (unit.revision >= Number.MAX_SAFE_INTEGER) throw new SyncError('capacity');
      snapshot.rev = unit.revision + 1;
      this.options.validateSnapshot?.(unitId, snapshot, context);
      const { beforeCells, touched } = changes(before, snapshot, unit.kind, mutations);
      const edit: SyncRevision = {
        unitId,
        revision: unit.revision + 1,
        baseRevision: request.baseRevision,
        actorId: request.actorId,
        mutationId: request.mutationId,
        requestHash,
        mutations: structuredClone(mutations),
        beforeCells,
        touched,
        hash: hashTouched(snapshot, touched),
      };
      this.storage.commit(
        {
          expectedRevision: unit.revision,
          unit: { ...unit, revision: edit.revision, snapshot },
          edit,
        },
        () => this.options.authorize(unitId, context, true),
      );
      const cached = this.cache.get(unitId);
      if (cached) cached.revision = edit.revision;
      // These describe delivered losses/offsets, not attempted transforms. A
      // refused candidate or failed transaction must not count them on a retry.
      for (const [rule, value] of dropped)
        this.observe(context, unitId, { name: 'sync.edit.dropped', rule, value });
      if (offsets) this.observe(context, unitId, { name: 'sync.edit.offset', value: offsets });
      return { duplicate: false, edit, missing: [...history, edit] };
    } catch (error) {
      // A rejected handler or failed commit may have mutated the candidate. The
      // next call replays from the durable head, never that partially changed model.
      this.invalidate(unitId);
      if (error instanceof RefusedEditError) {
        this.observe(context, unitId, {
          name: 'sync.edit.refused',
          reason: error.reason,
          mutationId: error.mutationId,
          againstMutationId: error.againstMutationId,
        });
        throw new SyncError('refused');
      }
      if (error instanceof UnsupportedMutationError) {
        this.observe(context, unitId, {
          name: 'sync.edit.unsupported',
          mutationId: error.mutationId,
        });
        throw new SyncError('unsupported');
      }
      if (error instanceof InvariantError) {
        this.observe(context, unitId, {
          name: 'sync.invariant.failed',
          invariant: error.invariant,
        });
        throw error;
      }
      if (
        error instanceof TypeError ||
        (error instanceof SyncError && error.code === 'malformed')
      ) {
        this.observe(context, unitId, {
          name: 'sync.edit.malformed',
          check: error instanceof MalformedEditError ? error.check : 'other',
        });
        throw new SyncError('malformed');
      }
      throw error;
    }
  }

  /** Compare only hashes; neither a mismatch nor its diagnostic contains content. */
  verify(unitId: string, revision: number, hash: string, context: Context): boolean {
    if (this.closed) throw new SyncError('unavailable');
    this.options.authorize(unitId, context, false);
    const unit = this.unit(unitId);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 2 ||
      revision > unit.revision ||
      !/^[0-9a-f]{64}$/.test(hash)
    )
      throw new SyncError('stale');
    const [entry] = this.storage.revisions(unitId, revision - 1, revision);
    if (!entry || entry.revision !== revision) throw new SyncError('stale');
    const matches = entry.hash === hash;
    if (!matches) this.observe(context, unitId, { name: 'sync.divergence.detected' });
    return matches;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.queues.values());
    for (const id of this.cache.keys()) this.invalidate(id);
  }
}
