import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { docFormulas, formatFormulaValue } from '@spinel/doc-formulas';
import type { DocFormula, FormulaResult } from '@spinel/doc-formulas';
import type { PreparedDocFormula } from '@spinel/print';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { formulaAdmission } from '../formulas/admission.ts';
import { DocFormulas } from '../formulas/service.ts';
import {
  resolveDocument,
  sourceDocumentContext,
  validateDocumentCredentials,
} from '../workspace/document-access.ts';
import { DocumentStore } from '../workspace/documents.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { PDF_LIMITS, PdfError } from './limits.ts';
import { checkPdfCapacity } from './capacity.ts';
import { preparePdfSnapshot } from './prepare.ts';
import { runPdf } from './runner.ts';
import type { PdfJob } from './runner.ts';

const FORMULAS_PER_PDF = 32;
const REQUEST_DEADLINE_MS = 60_000;
type Context = Readonly<Record<string, unknown>>;
type Verify = () => void;
type SourceProof = { id: string; context: Context; generation: string };
type FormulaEntry = { formula: DocFormula; prepared: PreparedDocFormula; sources: SourceProof[] };

/** Validate the small user-supplied selection before loading a native snapshot. */
export function pdfSelection(input: unknown): string[] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AuthError(400, 'Choose the worksheets to export.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'worksheetIds'))
    throw new AuthError(400, 'Choose the worksheets to export.');
  if (!Object.hasOwn(body, 'worksheetIds')) return undefined;
  const ids = body.worksheetIds;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > PDF_LIMITS.worksheets ||
    ids.some((id) => typeof id !== 'string' || !id || id.length > 512) ||
    new Set(ids).size !== ids.length
  )
    throw new AuthError(400, 'Choose at least one visible worksheet.');
  return [...ids] as string[];
}

function worksheets(snapshot: IWorkbookData) {
  if (!Array.isArray(snapshot.sheetOrder) || !snapshot.sheets) throw new PdfError('unsupported');
  if (snapshot.sheetOrder.length > PDF_LIMITS.worksheets) throw new PdfError('limit');
  return snapshot.sheetOrder.flatMap((id) => {
    const sheet = snapshot.sheets[id];
    if (!sheet || sheet.id !== id || typeof sheet.name !== 'string')
      throw new PdfError('unsupported');
    return sheet.hidden ? [] : [{ id, name: sheet.name }];
  });
}

function preparedResult(result: FormulaResult, formula: DocFormula): PreparedDocFormula['result'] {
  if (!result.ok) {
    // A resource failure must not masquerade as a complete successful export.
    if (result.reason === 'too-large') throw new PdfError('limit');
    if (result.reason === 'busy' || result.reason === 'timeout') throw new PdfError('busy');
    return { kind: 'unavailable' };
  }
  const format = (value: string | number | boolean | null) =>
    formatFormulaValue(value, formula.definition.format);
  return result.kind === 'scalar'
    ? { kind: 'scalar', value: format(result.value) }
    : { kind: 'table', rows: result.rows.map((row) => row.map(format)) };
}

/** Application authorization stays here; the renderer receives no credentials. */
export class PdfExports {
  private readonly workspace: WorkspaceStore;
  private readonly collaboration: CollaborationStore;
  private readonly documents: DocumentStore;
  private readonly formulas: DocFormulas;
  private readonly render: typeof runPdf;

  constructor(workspace: WorkspaceStore, collaboration: CollaborationStore, render = runPdf) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    this.documents = new DocumentStore(workspace);
    this.formulas = new DocFormulas(workspace, collaboration);
    this.render = render;
  }

  private async load(user: string, id: string, verify: Verify, context: Context) {
    let generation: string | undefined;
    const check = () => {
      verify();
      const item = resolveDocument(this.workspace, user, id, 'read', context);
      if (item.kind !== 'sheet' && item.kind !== 'doc')
        throw new AuthError(400, 'Only Sheets and Docs can be exported as PDF.');
      if (
        this.collaboration.generations.restoring(id) ||
        (generation !== undefined &&
          this.collaboration.generations.active(id).unitId !== generation)
      )
        throw new AuthError(409, 'This document was restored. Open it again before exporting.');
      return item;
    };
    check();
    checkPdfCapacity();
    await this.collaboration.prepare(user, id, context);
    check();
    generation = this.collaboration.generations.active(id).unitId;
    const data = await this.collaboration.load(user, id, context);
    const item = check();
    if (!data.snapshot) throw new AuthError(409, 'Open this document once before exporting it.');
    return { item, snapshot: data.snapshot, sourceUnitId: generation, check };
  }

  async options(user: string, id: string, verify: Verify, context: Context = {}) {
    validateDocumentCredentials(this.workspace, user, context);
    const loaded = await this.load(user, id, verify, Object.freeze({ ...context }));
    const result = {
      kind: loaded.item.kind,
      ...(loaded.item.kind === 'sheet'
        ? { worksheets: worksheets(loaded.snapshot as IWorkbookData) }
        : {}),
    };
    loaded.check();
    return result;
  }

  async export(
    user: string,
    id: string,
    selection: string[] | undefined,
    verify: Verify,
    context: Context = {},
    signal?: AbortSignal,
  ) {
    validateDocumentCredentials(this.workspace, user, context);
    const custom = Object.freeze({ ...context });
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let stopped: unknown;
    const deadline = performance.now() + REQUEST_DEADLINE_MS;
    const baseCheck = () => {
      if (stopped) throw stopped;
      if (controller.signal.aborted) throw new PdfError('cancelled');
      if (performance.now() >= deadline) throw new PdfError('limit');
      verify();
      resolveDocument(this.workspace, user, id, 'read', custom);
    };
    let current: Verify = baseCheck;
    const check = () => current();
    // Stop expensive native work promptly on host/session/link loss. Final checks
    // below remain authoritative even if a busy event loop delays this timer.
    const timer = setInterval(() => {
      try {
        check();
      } catch (error) {
        stopped = error;
        controller.abort();
      }
    }, 100);
    timer.unref();
    try {
      const loaded = await this.load(user, id, baseCheck, custom);
      current = loaded.check;
      const hostCheck = check;
      const kind = loaded.item.kind as 'sheet' | 'doc';
      if (kind === 'doc' && selection !== undefined)
        throw new AuthError(400, 'Worksheet selection is only available for Sheets.');
      if (kind === 'sheet') {
        const visible = worksheets(loaded.snapshot as IWorkbookData);
        if (!visible.length || selection?.some((sheet) => !visible.some(({ id }) => id === sheet)))
          throw new AuthError(400, 'Choose at least one visible worksheet.');
      }
      const prepared = preparePdfSnapshot(kind, id, loaded.snapshot, {
        worksheetIds: selection,
        sourceUnitId: loaded.sourceUnitId,
        readImage: (imageId) => {
          hostCheck();
          return this.documents.image(user, id, imageId, custom);
        },
      });
      const imagesCheck = () => {
        hostCheck();
        for (const imageId of prepared.imageIds)
          if (
            !this.workspace.auth.database
              .prepare('SELECT 1 FROM doc_images WHERE item_id=? AND id=?')
              .get(id, imageId)
          )
            throw new AuthError(409, 'An image changed. Try exporting again.');
      };
      const sourceCheck = (source: SourceProof) => {
        resolveDocument(this.workspace, user, source.id, 'read', source.context);
        if (
          this.collaboration.generations.restoring(source.id) ||
          this.collaboration.generations.active(source.id).unitId !== source.generation
        )
          throw new AuthError(409, 'A Formula source was restored. Try exporting again.');
      };
      const entries: FormulaEntry[] = [];
      if (kind === 'doc') {
        const formulas = docFormulas((loaded.snapshot as IDocumentData).body);
        if (formulas.length > FORMULAS_PER_PDF) throw new PdfError('limit');
        for (const formula of formulas) {
          imagesCheck();
          const sources: SourceProof[] = [];
          let inaccessible = false;
          for (const sourceId of new Set(formula.definition.references.map((ref) => ref.itemId))) {
            try {
              const scope = sourceDocumentContext(this.workspace, user, id, sourceId, custom);
              const source = {
                id: sourceId,
                context: scope,
                generation: this.collaboration.generations.active(sourceId).unitId,
              };
              sourceCheck(source);
              sources.push(source);
            } catch (error) {
              imagesCheck();
              if (!(error instanceof AuthError) || ![403, 404].includes(error.status)) throw error;
              inaccessible = true;
              break;
            }
          }
          const result = inaccessible
            ? { kind: 'unavailable' as const }
            : preparedResult(
                await this.formulas.evaluate(
                  user,
                  id,
                  formula.definition,
                  imagesCheck,
                  user.startsWith('guest:'),
                  custom,
                  controller.signal,
                ),
                formula,
              );
          imagesCheck();
          entries.push({ formula, prepared: { rangeId: formula.id, result }, sources });
        }
      }
      const invalidate = () => {
        imagesCheck();
        let changed = false;
        for (const entry of entries) {
          if (entry.prepared.result.kind === 'unavailable') continue;
          for (const source of entry.sources) {
            try {
              sourceCheck(source);
            } catch (error) {
              imagesCheck();
              if (!(error instanceof AuthError) || ![403, 404].includes(error.status)) throw error;
              // Replace the entire value, including every row and all aggregate
              // inputs. Old bytes are discarded, never painted over or reused.
              entry.prepared = { rangeId: entry.formula.id, result: { kind: 'unavailable' } };
              changed = true;
              break;
            }
          }
        }
        return changed;
      };
      invalidate();
      for (let attempt = 0; attempt < 2; attempt++) {
        imagesCheck();
        const release = await formulaAdmission.acquire(imagesCheck, controller.signal);
        let result: Awaited<ReturnType<typeof runPdf>>;
        try {
          const job: PdfJob =
            kind === 'sheet'
              ? {
                  kind,
                  input: { snapshot: prepared.snapshot as IWorkbookData, images: prepared.images },
                  worksheetIds: selection,
                }
              : {
                  kind,
                  input: {
                    snapshot: prepared.snapshot as IDocumentData,
                    images: prepared.images,
                    formulas: entries.map((entry) => entry.prepared),
                  },
                };
          result = await this.render(job, controller.signal);
        } finally {
          release();
        }
        imagesCheck();
        if (invalidate()) {
          result.bytes.fill(0);
          if (attempt === 0) continue;
          throw new AuthError(409, 'Formula access changed again. Try exporting again.');
        }
        return {
          ...result,
          filename: `${
            Array.from(loaded.item.name, (character) =>
              character.charCodeAt(0) < 32 ||
              character.charCodeAt(0) === 127 ||
              '/\\'.includes(character)
                ? '_'
                : character,
            )
              .join('')
              .slice(0, 160) || 'Document'
          }.pdf`,
          verify: () => {
            imagesCheck();
            if (invalidate())
              throw new AuthError(409, 'Formula access changed. Try exporting again.');
          },
        };
      }
      throw new PdfError('failed');
    } catch (error) {
      if (stopped) throw stopped;
      throw error;
    } finally {
      clearInterval(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
