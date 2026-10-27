import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { WorkspaceItem } from './workspace.ts';
import { validColor, validIdentityIcon } from './appearance.ts';

/** Saved before first editing; native edits remain in the existing checkpoint queue. */
export interface OfflineCreationRequest {
  version: 1;
  itemId: string;
  unitId: string;
  kind: 'sheet' | 'doc';
  name: string;
  parentId: string | null;
  icon?: string | null;
  iconColor?: string | null;
}

export interface OfflineCreationResponse {
  item: WorkspaceItem;
  unitId: string;
  /** The immutable initial base, not a claim about the current live head. */
  revision: 1;
  revisionOffset: 0;
  syncVersion: 1;
}

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** Admit the same bounded, immutable request from IndexedDB and HTTP. */
export function isOfflineCreationRequest(value: unknown): value is OfflineCreationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Partial<OfflineCreationRequest>;
  return (
    input.version === 1 &&
    uuid(input.itemId) &&
    uuid(input.unitId) &&
    input.itemId !== input.unitId &&
    (input.kind === 'sheet' || input.kind === 'doc') &&
    typeof input.name === 'string' &&
    input.name.length > 0 &&
    input.name.length <= 120 &&
    input.name === input.name.trim() &&
    !/[\p{Cc}/\\]/u.test(input.name) &&
    (input.parentId === null || uuid(input.parentId)) &&
    input.parentId !== input.itemId &&
    input.parentId !== input.unitId &&
    (input.icon == null || validIdentityIcon(input.icon)) &&
    (input.iconColor == null || validColor(input.iconColor)) &&
    Object.keys(input).every((key) =>
      ['version', 'itemId', 'unitId', 'kind', 'name', 'parentId', 'icon', 'iconColor'].includes(
        key,
      ),
    )
  );
}

/**
 * Version 1's deterministic empty document. Both peers start with this base;
 * creation never uploads a mutable snapshot or turns queued edits into a replacement.
 */
export function blankOfflineSnapshot(
  input: Pick<OfflineCreationRequest, 'itemId' | 'kind' | 'name'>,
): IWorkbookData | IDocumentData {
  if (input.kind === 'doc') {
    const snapshot = getDocsEmptySnapshot(input.itemId);
    // The SDK chooses random paragraph/section IDs for an ordinary new Doc.
    // Offline peers need identical native identities before replaying edits.
    snapshot.body!.paragraphs = snapshot.body!.paragraphs!.map((paragraph, index) => ({
      ...paragraph,
      paragraphId: `para_${input.itemId}_${index}`,
    }));
    snapshot.body!.sectionBreaks = snapshot.body!.sectionBreaks!.map((section, index) => ({
      ...section,
      sectionId: `section_${input.itemId}_${index}`,
    }));
    return { ...snapshot, title: input.name, rev: 1 };
  }
  return {
    id: input.itemId,
    name: input.name,
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    rev: 1,
    sheetOrder: ['first'],
    styles: {},
    sheets: {
      first: {
        id: 'first',
        name: 'Sheet1',
        rowCount: 1000,
        columnCount: 26,
        cellData: {},
      },
    },
  };
}
