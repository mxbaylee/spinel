import {
  CommandType,
  createParagraphId,
  CustomCommandExecutionError,
  ICommandService,
  IUniverInstanceService,
  PRESERVE_INSERTED_PARAGRAPH_IDS,
  UniverInstanceType,
} from '@univerjs/core';
import type {
  DocumentDataModel,
  IExecutionOptions,
  IRange,
  Univer,
  Workbook,
} from '@univerjs/core';
import { SheetsSelectionsService } from '@univerjs/sheets';
import { supportedMutationIds } from '@spinel/sync-transform';
import type { Mutation } from '@spinel/sync-transform';
import { ClientError, MAX_PENDING_BYTES } from './types.ts';
import type { ClientFailure } from './types.ts';
import { byteBudget, encodedBytes } from './hash.ts';
import { admitNativeMutation } from './admission.ts';

const supported = new Set(supportedMutationIds);
// The pinned public ClearSheet/DocDrawingTransformerOperation handlers refresh
// renderer controls only. Unknown operation-shaped mutations still fail admission.
const renderOnly = new Set([
  'sheet.operation.clear-drawing-transformer',
  'doc.operation.clear-drawing-transformer',
]);
const shifts: Record<string, { axis: 'row' | 'column'; kind: 'insert' | 'remove' }> = {
  'sheet.command.insert-range-move-down': { axis: 'row', kind: 'insert' },
  'sheet.command.insert-range-move-right': { axis: 'column', kind: 'insert' },
  'sheet.command.delete-range-move-up': { axis: 'row', kind: 'remove' },
  'sheet.command.delete-range-move-left': { axis: 'column', kind: 'remove' },
};
type Shift = { axis: 'row' | 'column'; kind: 'insert' | 'remove'; at: number; count: number };
const local = (options?: IExecutionOptions) =>
  !options?.onlyLocal && !options?.fromCollab && !options?.fromChangeset;

export interface NativeCaptureOptions {
  univer: Univer;
  unitId: string;
  onMutation(mutation: Mutation): void;
  onFailure(reason: ClientFailure): void;
  canEdit?(): boolean;
}

/**
 * Only the public collaboration stream supplies outgoing edits. The before
 * hook records disappearing worksheet positions and shift-command context,
 * and prepares stable paragraph IDs before the visible native mutation runs.
 */
export function captureNative(options: NativeCaptureOptions) {
  const injector = options.univer.__getInjector();
  const commands = injector.get(ICommandService);
  const instances = injector.get(IUniverInstanceService);
  const metadata = new WeakMap<object, { index?: number; shift?: Shift }>();
  const shiftCommands = new Map<string, Shift>();
  let disposed = false;
  const workbook = () =>
    instances.getUnit<Workbook>(options.unitId, UniverInstanceType.UNIVER_SHEET);
  const fail = (reason: ClientFailure): never => {
    options.onFailure(reason);
    throw new CustomCommandExecutionError(
      'This edit could not be synchronized. Reload to continue.',
    );
  };
  const before = commands.beforeCommandExecuted((info, execution) => {
    if (disposed || !local(execution)) return;
    const params = info.params as Record<string, any> | undefined;
    const shift = shifts[info.id];
    if (
      shift &&
      instances.getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET)?.getUnitId() ===
        options.unitId
    ) {
      const range =
        (params?.range as IRange | undefined) ??
        injector.get(SheetsSelectionsService).getCurrentLastSelection()?.range;
      if (range) {
        const [at, end] =
          shift.axis === 'row'
            ? [range.startRow, range.endRow]
            : [range.startColumn, range.endColumn];
        shiftCommands.set(info.id, { ...shift, at, count: end - at + 1 });
      }
    }
    if (
      info.type !== CommandType.MUTATION ||
      renderOnly.has(info.id) ||
      (params?.unitId !== undefined && params.unitId !== options.unitId)
    )
      return;
    if (options.canEdit?.() === false) fail('unavailable');
    if (!supported.has(info.id)) fail('unsupported');
    if (!params || params.unitId !== options.unitId) return fail('malformed');
    try {
      assertSenderParams(params);
      // syncOnly skips this handler; do not count a second structural effect.
      // A handler that executes locally must be bounded before it can allocate.
      if (!execution?.syncOnly) admitNativeMutation({ id: info.id, params }, workbook() ?? null);
      if (info.id === 'sheet.mutation.remove-sheet') {
        const index = workbook()?.getSheetOrders().indexOf(params.subUnitId);
        if (index === undefined || index < 0) throw new ClientError('malformed');
        metadata.set(params, { index });
      }
      if (info.id === 'sheet.mutation.move-range' && shifts[params.trigger]) {
        const context = shiftCommands.get(params.trigger);
        if (context) metadata.set(params, { shift: { ...context } });
      }
      if (info.id === 'doc.mutation.rich-text-editing' && !execution?.syncOnly) {
        const document = instances.getUnit<DocumentDataModel>(
          options.unitId,
          UniverInstanceType.UNIVER_DOC,
        );
        const body = document?.getSelfOrHeaderFooterModel(params.segmentId ?? '')?.getBody();
        const existing = new Set(
          body?.paragraphs?.flatMap((paragraph) =>
            paragraph.paragraphId ? [paragraph.paragraphId] : [],
          ),
        );
        params.actions = structuredClone(params.actions);
        preserveParagraphs(params.actions, existing);
      }
    } catch (error) {
      fail(error instanceof ClientError ? error.reason : 'malformed');
    }
  });
  const capture = commands.onMutationExecutedForCollab((info, execution) => {
    const original = info.params as Record<string, any> | undefined;
    if (
      disposed ||
      !local(execution) ||
      renderOnly.has(info.id) ||
      (original?.unitId !== undefined && original.unitId !== options.unitId)
    )
      return;
    try {
      if (!supported.has(info.id)) throw new ClientError('unsupported');
      if (!original || original.unitId !== options.unitId) throw new ClientError('malformed');
      assertSenderParams(original);
      const charge = byteBudget();
      charge(original);
      const mutation: Mutation = { id: info.id, params: structuredClone(original) };
      const params = mutation.params;
      // Native commands use arrays here, while the transport admits sparse
      // metadata maps. The public native handlers read relative numeric keys.
      if (info.id === 'sheet.mutation.insert-row' && Array.isArray(params.rowInfo))
        params.rowInfo = Object.fromEntries(Object.entries(params.rowInfo));
      if (info.id === 'sheet.mutation.insert-col' && Array.isArray(params.colInfo))
        params.colInfo = Object.fromEntries(Object.entries(params.colInfo));
      const saved = metadata.get(original);
      if (info.id === 'sheet.mutation.remove-sheet') {
        if (saved?.index === undefined) throw new ClientError('malformed');
        params.index = saved.index;
      }
      if (
        info.id === 'sheet.mutation.move-range' &&
        shifts[params.trigger] &&
        Object.keys(params.from?.value ?? {}).length > 0
      ) {
        const kind = shifts[params.trigger];
        const key = kind.axis === 'row' ? 'startRow' : 'startColumn';
        const from = params.fromRange[key],
          to = params.toRange[key];
        params.shift = saved?.shift ?? {
          ...kind,
          at: Math.min(from, to),
          count: Math.abs(to - from),
        };
      }
      inlineStyles(mutation, (id) => {
        const value = workbook()?.getStyles().get(id);
        if (!value) throw new ClientError('malformed');
        charge(value);
        return structuredClone(value);
      });
      // A syncOnly producer has already realized its paragraph IDs. Mark its
      // copied inserts too, without executing or inventing a second local edit.
      if (info.id === 'doc.mutation.rich-text-editing') preserveParagraphs(params.actions);
      options.onMutation(mutation);
    } catch (error) {
      options.onFailure(error instanceof ClientError ? error.reason : 'malformed');
    }
  });
  return {
    dispose() {
      disposed = true;
      before.dispose();
      capture.dispose();
      shiftCommands.clear();
    },
  };
}

/** Never allow sender-supplied transform-private marks to enter a local edit. */
function assertSenderParams(params: unknown) {
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 500_000 || depth > 64) throw new ClientError('capacity');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (
        key === 'derived' ||
        key.startsWith('sync-transform.') ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        throw new ClientError('malformed');
      visit(child, depth + 1);
    }
  };
  visit(params, 0);
  if (encodedBytes(params) > MAX_PENDING_BYTES) throw new ClientError('capacity');
}

function preserveParagraphs(value: unknown, existing?: Set<string>) {
  if (!value || typeof value !== 'object') return;
  const action = value as Record<string, any>;
  if (action.t === 'i' && action.body && typeof action.body === 'object') {
    for (const paragraph of action.body.paragraphs ?? []) {
      // Realize once before the local apply, not independently on every peer.
      if (existing && (!paragraph.paragraphId || existing.has(paragraph.paragraphId)))
        paragraph.paragraphId = createParagraphId(existing);
      if (!paragraph.paragraphId) throw new ClientError('malformed');
      existing?.add(paragraph.paragraphId);
    }
    action.body[PRESERVE_INSERTED_PARAGRAPH_IDS] = true;
  }
  for (const child of Object.values(value)) preserveParagraphs(child, existing);
}

function inlineStyles(mutation: Mutation, resolve: (id: string) => unknown) {
  const p = mutation.params;
  const slot = (value: Record<string, any> | null | undefined, key = 's') => {
    if (value && typeof value[key] === 'string') value[key] = resolve(value[key]);
  };
  const rows = (value: Record<string, any> | undefined) => {
    for (const entry of Object.values(value ?? {})) slot(entry);
  };
  const matrix = (value: Record<string, any> | undefined) => {
    for (const row of Object.values(value ?? {})) rows(row);
  };
  switch (mutation.id) {
    case 'sheet.mutation.set-range-values':
      matrix(p.cellValue);
      break;
    case 'sheet.mutation.move-range':
      matrix(p.from?.value);
      matrix(p.to?.value);
      break;
    case 'sheet.mutation.set-worksheet-default-style':
      slot(p, 'defaultStyle');
      break;
    case 'sheet.mutation.set-row-data':
      rows(p.rowData);
      break;
    case 'sheet.mutation.set-col-data':
      rows(p.columnData);
      break;
    case 'sheet.mutation.insert-row':
      rows(p.rowInfo);
      break;
    case 'sheet.mutation.insert-col':
      rows(p.colInfo);
      break;
    case 'sheet.mutation.insert-sheet':
      slot(p.sheet, 'defaultStyle');
      matrix(p.sheet?.cellData);
      rows(p.sheet?.rowData);
      rows(p.sheet?.columnData);
      break;
  }
}
