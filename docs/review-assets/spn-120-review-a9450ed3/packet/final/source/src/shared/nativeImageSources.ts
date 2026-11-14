type ObjectValue = Record<string, unknown>;
type Location =
  | 'snapshot'
  | 'segments'
  | 'worksheets'
  | 'worksheet'
  | 'cells'
  | 'row'
  | 'cell'
  | 'drawings'
  | 'image'
  | 'source'
  | 'drawingUnits'
  | 'drawingSheets'
  | 'drawingCollection';

const object = (value: unknown): value is ObjectValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const segments = new Set(['headers', 'footers', 'footnotes', 'endnotes', 'notes']);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

export class NativeImageError extends Error {}

/** Schema paths, including JSON1 component paths, never descend into custom data. */
function child(location: Location | undefined, key: string | number): Location | undefined {
  switch (location) {
    case 'snapshot':
      if (key === 'sheets') return 'worksheets';
      if (key === 'drawings') return 'drawings';
      if (segments.has(String(key))) return 'segments';
      return;
    case 'segments':
      return 'snapshot';
    case 'worksheets':
      return 'worksheet';
    case 'worksheet':
      if (key === 'backgroundImage') return 'image';
      if (key === 'cellData') return 'cells';
      return;
    case 'cells':
      return 'row';
    case 'row':
      return 'cell';
    case 'cell':
      return key === 'p' ? 'snapshot' : undefined;
    case 'drawings':
      return 'image';
    case 'image':
      return key === 'source' ? 'source' : undefined;
    case 'drawingUnits':
      return 'drawingSheets';
    case 'drawingSheets':
      return 'drawingCollection';
    case 'drawingCollection':
      return key === 'data' ? 'drawings' : undefined;
  }
}

/**
 * Mutate only native image sources. Supports snapshots, native mutation groups,
 * protocol frames and local checkpoints. A root string is an explicit image
 * service request; ordinary text nested anywhere else is never an image.
 */
export function mapNativeImageSources<T>(
  value: T,
  map: (source: string) => string,
  options: { updateSourceType?: boolean } = {},
): T {
  let nodes = 0;
  let changes = 0;
  const count = (depth: number) => {
    if (++nodes > 200_000 || depth > 64)
      throw new NativeImageError('Image data is nested too deeply or is too large.');
  };
  const visit = (entry: unknown, location: Location, depth: number): unknown => {
    count(depth);
    if (location === 'source') {
      if (typeof entry !== 'string') throw new NativeImageError('Invalid document images.');
      const source = map(entry);
      if (source !== entry) changes++;
      return source;
    }
    if (!entry || typeof entry !== 'object') return entry;
    const record = entry as ObjectValue;
    if (location === 'cells') {
      // A large plain grid has no image tree to walk. Charge only rich-cell
      // documents, as with native snapshot admission before this shared helper.
      for (const row of Object.values(record))
        if (row && typeof row === 'object')
          for (const cell of Object.values(row))
            if (object(cell) && object(cell.p)) visit(cell.p, 'snapshot', depth + 1);
      return entry;
    }
    for (const [key, nested] of Object.entries(record)) {
      if (forbidden.has(key)) throw new NativeImageError('Invalid document images.');
      const next = child(location, key);
      if (!next) continue;
      const replacement = visit(nested, next, depth + 1);
      if (replacement !== nested) {
        record[key] = replacement;
        if (location === 'image' && key === 'source' && options.updateSourceType)
          record.imageSourceType = String(replacement).startsWith('data:image/') ? 'BASE64' : 'URL';
      }
    }
    if (location === 'snapshot' && Array.isArray(record.resources)) {
      for (const resource of record.resources) {
        count(depth + 1);
        if (
          !object(resource) ||
          !['DOC_DRAWING_PLUGIN', 'SHEET_DRAWING_PLUGIN'].includes(String(resource.name))
        )
          continue;
        let data: unknown;
        try {
          if (typeof resource.data !== 'string') throw new Error();
          data = JSON.parse(resource.data);
        } catch {
          throw new NativeImageError('Invalid document images.');
        }
        const previous = changes;
        visit(
          data,
          resource.name === 'SHEET_DRAWING_PLUGIN'
            ? 'drawingSheets'
            : object(data) && Object.hasOwn(data, 'data')
              ? 'drawingCollection'
              : 'drawings',
          depth + 2,
        );
        // Preserve opaque resources and unchanged native JSON byte for byte.
        if (changes !== previous) resource.data = JSON.stringify(data);
      }
    }
    return entry;
  };
  const operation = (op: unknown, location: Location | undefined, depth: number) => {
    count(depth);
    if (!Array.isArray(op)) return;
    let current = location;
    for (const component of op) {
      if (typeof component === 'string' || typeof component === 'number') {
        if (forbidden.has(String(component)))
          throw new NativeImageError('Invalid document images.');
        current = child(current, component);
      } else if (Array.isArray(component)) operation(component, current, depth + 1);
      else if (object(component) && current) {
        // Removal payloads also carry native sources and participate in replay.
        for (const key of ['i', 'r'])
          if (Object.hasOwn(component, key) && component[key] !== true)
            component[key] = visit(component[key], current, depth + 1);
      }
    }
  };
  const mutation = (entry: ObjectValue, depth: number) => {
    if (!object(entry.params)) return;
    const params = entry.params;
    switch (entry.id) {
      case 'sheet.mutation.set-range-values':
        visit(params.cellValue, 'cells', depth + 1);
        break;
      case 'sheet.mutation.move-range':
        for (const key of ['from', 'to'])
          if (object(params[key])) visit(params[key].value, 'cells', depth + 1);
        break;
      case 'sheet.mutation.insert-sheet':
        visit(params.sheet, 'worksheet', depth + 1);
        break;
      case 'sheet.mutation.set-worksheet-background-image':
        visit(params.backgroundImage, 'image', depth + 1);
        break;
      case 'sheet.mutation.set-drawing-apply':
        operation(params.op, 'drawingUnits', depth + 1);
        break;
      case 'doc.mutation.rich-text-editing':
        operation(params.actions, 'snapshot', depth + 1);
        break;
    }
  };
  const envelope = (entry: unknown, depth: number): unknown => {
    count(depth);
    if (typeof entry === 'string') return depth === 0 ? map(entry) : entry;
    if (Array.isArray(entry)) {
      for (const nested of entry) envelope(nested, depth + 1);
    } else if (object(entry)) {
      if (typeof entry.id === 'string' && object(entry.params)) mutation(entry, depth + 1);
      else if (entry.version === 1 && object(entry.snapshot) && Array.isArray(entry.buffer)) {
        visit(entry.snapshot, 'snapshot', depth + 1);
        if (entry.recoverySnapshot) visit(entry.recoverySnapshot, 'snapshot', depth + 1);
        envelope(entry.sent, depth + 1);
        envelope(entry.inflight, depth + 1);
        envelope(entry.buffer, depth + 1);
      } else if (['submit', 'edit', 'ack'].includes(String(entry.type))) {
        envelope(entry.mutations, depth + 1);
      } else if (entry.type === 'resume' && Array.isArray(entry.edits)) {
        for (const edit of entry.edits) if (object(edit)) envelope(edit.mutations, depth + 1);
      } else visit(entry, 'snapshot', depth + 1);
    }
    return entry;
  };
  return envelope(value, 0) as T;
}
