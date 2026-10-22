import type { IWorkbookData } from '@univerjs/core';
import {
  FORMULA_FORMATS,
  FORMULA_LIMITS,
  parseFormula,
  validateFormulaDefinition,
} from '@spinel/doc-formulas';
import type {
  FormulaDefinition,
  FormulaFormat,
  FormulaReference,
  FormulaResult,
  FormulaSource,
} from '@spinel/doc-formulas';
import { AuthError } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import { resolveDocument, sourceDocumentContext } from '../workspace/document-access.ts';
import { documentCatalog } from '../workspace/document-catalog.ts';
import { runFormula } from './runner.ts';

// Admission covers materialization as well as calculation, across all router instances.
let reading = false;
const privateSource = (): FormulaResult => ({ ok: false, reason: 'private-source' });
const invalid = () => new AuthError(400, 'Use a valid formula and choose its source sheets.');
type Verify = () => void;

export class DocFormulas {
  private readonly workspace: WorkspaceStore;
  private readonly collaboration: CollaborationStore;
  private readonly calculate: typeof runFormula;
  constructor(
    workspace: WorkspaceStore,
    collaboration: CollaborationStore,
    calculate = runFormula,
  ) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    this.calculate = calculate;
  }
  private host(user: string, id: string, verify: Verify, customData: Record<string, unknown>) {
    verify();
    if (resolveDocument(this.workspace, user, id, 'read', customData).kind !== 'doc')
      throw new AuthError(400, 'Formulas can be inserted in Docs.');
  }
  private source(user: string, hostId: string, id: string, customData: Record<string, unknown>) {
    const context = sourceDocumentContext(this.workspace, user, hostId, id, customData);
    const item = resolveDocument(this.workspace, user, id, 'read', context);
    if (item.kind !== 'sheet') throw invalid();
    return { item, context };
  }
  private async load(
    user: string,
    hostId: string,
    id: string,
    verify: Verify,
    customData: Record<string, unknown>,
  ) {
    verify();
    const { context } = this.source(user, hostId, id, customData);
    await this.collaboration.prepare(user, id, context);
    verify();
    this.source(user, hostId, id, customData);
    const generation = this.collaboration.generations.active(id).unitId;
    const data = await this.collaboration.load(user, id, context);
    verify();
    this.source(user, hostId, id, customData);
    this.current(id, generation);
    // Bound the payload before structured cloning it into the worker.
    if (Buffer.byteLength(JSON.stringify(data.snapshot)) > 8 * 1024 * 1024)
      throw new AuthError(413, 'This source is too large for a Doc formula.');
    return { itemId: id, snapshot: data.snapshot as IWorkbookData, generation };
  }
  private current(id: string, generation: string) {
    if (
      this.collaboration.generations.active(id).unitId !== generation ||
      this.collaboration.generations.restoring(id)
    )
      throw new AuthError(409, 'A source was restored. Refresh the formula.');
  }
  sources(user: string, hostId: string, verify: Verify, customData: Record<string, unknown> = {}) {
    this.host(user, hostId, verify, customData);
    return documentCatalog(this.workspace, user, customData)
      .filter((item) => item.kind === 'sheet')
      .map((item) => ({ itemId: item.id, name: item.name }));
  }
  async sheets(
    user: string,
    hostId: string,
    sourceId: string,
    verify: Verify,
    customData: Record<string, unknown> = {},
  ) {
    this.host(user, hostId, verify, customData);
    if (reading) throw new AuthError(429, 'Another formula is loading. Try again shortly.');
    reading = true;
    try {
      const source = await this.load(
        user,
        hostId,
        sourceId,
        () => this.host(user, hostId, verify, customData),
        customData,
      );
      this.host(user, hostId, verify, customData);
      this.source(user, hostId, sourceId, customData);
      this.current(sourceId, source.generation);
      return source.snapshot.sheetOrder.map((id) => ({
        sheetId: id,
        name: source.snapshot.sheets[id].name,
      }));
    } finally {
      reading = false;
    }
  }
  async resolve(
    user: string,
    hostId: string,
    input: unknown,
    verify: Verify,
    guest = false,
    customData: Record<string, unknown> = {},
  ): Promise<FormulaDefinition> {
    this.host(user, hostId, verify, customData);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !['expression', 'format', 'previous', 'bindings'].includes(key),
      ) ||
      typeof body.expression !== 'string' ||
      (body.format !== undefined && !FORMULA_FORMATS.includes(body.format as FormulaFormat))
    )
      throw invalid();
    let parsed: ReturnType<typeof parseFormula>;
    let previous: FormulaDefinition | undefined;
    let selected: FormulaReference[] = [];
    try {
      parsed = parseFormula(body.expression);
      previous = body.previous === undefined ? undefined : validateFormulaDefinition(body.previous);
      if (body.bindings !== undefined) {
        if (!Array.isArray(body.bindings) || body.bindings.length > parsed.length) throw invalid();
        const bindings = body.bindings as FormulaReference[];
        const starts = bindings.map((binding) => binding?.start);
        if (new Set(starts).size !== starts.length) throw invalid();
        selected = bindings.map((binding) => {
          const reference = parsed.find(
            (entry) => entry.start === binding?.start && entry.end === binding?.end,
          );
          if (!reference) throw invalid();
          // A picker can bind one reference before other manually typed ones
          // resolve. Validate that binding with the persisted-reference schema.
          const expression = `=${(body.expression as string).slice(reference.start, reference.end)}`;
          const single = validateFormulaDefinition({
            version: 1,
            expression,
            references: [{ ...binding, start: 1, end: expression.length }],
          });
          return { ...single.references[0], start: reference.start, end: reference.end };
        });
      }
    } catch {
      throw invalid();
    }
    if (guest && !customData.spaceId && parsed.length)
      throw new AuthError(403, 'A guest link does not grant access to source spreadsheets.');
    if (reading) throw new AuthError(429, 'Another formula is loading. Try again shortly.');
    reading = true;
    try {
      const previousParsed = previous ? parseFormula(previous.expression) : [];
      const sameQualifier = (first: (typeof parsed)[number], second: (typeof parsed)[number]) =>
        first.documentName === second.documentName && first.sheetName === second.sheetName;
      const sameQualifierOrder =
        parsed.length === previousParsed.length &&
        parsed.every((reference, index) => sameQualifier(reference, previousParsed[index]));
      const prior = parsed.map((reference, index) => {
        const picked = selected.find((candidate) => candidate.start === reference.start);
        if (picked) return picked;
        // Editing a cell address must not rebind a renamed source to its namesake.
        // With unchanged qualifier order, even duplicate names retain each slot's identity.
        if (previous && sameQualifierOrder) return previous.references[index];
        const matches = previous?.references.filter((_, previousIndex) =>
          sameQualifier(reference, previousParsed[previousIndex]),
        );
        if (!matches?.length) return undefined;
        if (
          new Set(matches.map((candidate) => `${candidate.itemId}/${candidate.sheetId}`)).size > 1
        )
          throw new AuthError(400, 'Choose the intended spreadsheet again for this reference.');
        return matches[0];
      });
      // Stable bindings do not need a discovery scan. A large unrelated catalog
      // must not make an already-bound, independently authorized formula unusable.
      const catalog = prior.some((binding) => !binding)
        ? documentCatalog(this.workspace, user, customData)
        : [];
      const items = parsed.map((reference, index) => {
        if (prior[index]) return this.source(user, hostId, prior[index]!.itemId, customData).item;
        const matches = catalog.filter(
          (item) => item.kind === 'sheet' && item.name === reference.documentName,
        );
        if (matches.length !== 1)
          throw new AuthError(
            400,
            'Each document name must identify one spreadsheet you can open.',
          );
        return matches[0];
      });
      if (new Set(items.map((item) => item.id)).size > FORMULA_LIMITS.sources) throw invalid();
      const loaded = new Map<string, Awaited<ReturnType<DocFormulas['load']>>>();
      const check = () => {
        this.host(user, hostId, verify, customData);
        for (const item of items) this.source(user, hostId, item.id, customData);
        for (const source of loaded.values()) this.current(source.itemId, source.generation);
      };
      check();
      for (const item of items)
        if (!loaded.has(item.id)) {
          loaded.set(item.id, await this.load(user, hostId, item.id, check, customData));
          check();
        }
      const references = parsed.map((reference, index) => {
        const item = items[index];
        const sheets = Object.entries(loaded.get(item.id)!.snapshot.sheets).filter(([id, sheet]) =>
          prior[index] ? id === prior[index]!.sheetId : sheet.name === reference.sheetName,
        );
        if (sheets.length !== 1)
          throw new AuthError(400, 'Each sheet name must identify one sheet in its document.');
        return {
          start: reference.start,
          end: reference.end,
          itemId: item.id,
          sheetId: sheets[0][0],
          range: reference.range,
        };
      });
      check();
      return validateFormulaDefinition({
        version: 1,
        expression: body.expression,
        references,
        ...(body.format === undefined ? {} : { format: body.format }),
      });
    } finally {
      reading = false;
    }
  }
  async evaluate(
    user: string,
    hostId: string,
    input: unknown,
    verify: Verify,
    guest = false,
    customData: Record<string, unknown> = {},
  ): Promise<FormulaResult> {
    this.host(user, hostId, verify, customData);
    let definition: FormulaDefinition;
    try {
      definition = validateFormulaDefinition(input);
    } catch {
      return { ok: false, reason: 'invalid-formula' };
    }
    if (guest && !customData.spaceId && definition.references.length)
      return { ok: false, reason: 'missing-source' };
    if (reading) return { ok: false, reason: 'busy' };
    reading = true;
    try {
      const ids = [...new Set(definition.references.map((reference) => reference.itemId))];
      const sources: (FormulaSource & { generation: string })[] = [];
      const check = () => {
        this.host(user, hostId, verify, customData);
        for (const id of ids) this.source(user, hostId, id, customData);
        for (const source of sources) this.current(source.itemId, source.generation);
      };
      try {
        check();
        for (const id of ids) {
          sources.push(await this.load(user, hostId, id, check, customData));
          check();
        }
        const bytes = sources.reduce(
          (total, source) => total + Buffer.byteLength(JSON.stringify(source.snapshot)),
          0,
        );
        if (bytes > 8 * 1024 * 1024) return { ok: false, reason: 'too-large' };
        const result = await this.calculate(definition, sources);
        check();
        return result;
      } catch (error) {
        // A lost host/session is an authorization failure, not a source placeholder.
        this.host(user, hostId, verify, customData);
        if (error instanceof AuthError) {
          if (error.status === 404 || error.status === 403) return privateSource();
          if (error.status === 413) return { ok: false, reason: 'too-large' };
          if (error.status === 409) return { ok: false, reason: 'unavailable' };
        }
        throw error;
      }
    } finally {
      reading = false;
    }
  }
}
