import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  DocCallbackAttribution,
  DocCallbackCallsite,
} from '../scripts/ci/doc-callback-lifetimes.ts';

// The baseline and the reviewed SPN-113 repair are both valid observations.
// Hash the complete embedded package, so a stale map or a similarly named file
// cannot supply target attribution. SPN-119 must revisit these with the patch.
const docsUiSources = new Set([
  '39edbad37992dd2af30f6bac56a05fc5d82c0a74078f330047e00fb0b48d1c11',
  '5e102d42b6ccafcbbf33bbc58f16e5c1bb20f43dd286c6f2b8520740d73356d4',
  '5e9d899115f96bab1dd66debdc5446c879f2df69577b2ef32524288faafaa7eb',
  'c405e5aa878779ffdd911f16a361c3d965b7ad82f6c14bdf4d0257c6d8122606',
]);
const cursorRegion = 'src/services/selection/text-range.ts';
const zoomRegion = 'src/controllers/render-controllers/zoom.render-controller.ts';
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const offset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const inside = (directory: string, path: string) => {
  const pathFromRoot = relative(directory, path);
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
};
type EventName = 'TimerInstall' | 'TimerRemove' | 'FunctionCall';
type RawPoint = { url: unknown; lineNumber: unknown; columnNumber: unknown };
type Point = { url: string; lineNumber: number; columnNumber: number };
type Observation = {
  point: RawPoint | null;
  firstEventIndex: number;
  occurrences: number;
  eventNames: EventName[];
};

export type DocCallbackUnmappedSource = Observation & { reason: string };
export type DocCallbackSourceArtifact =
  | {
      kind: 'runtime' | 'source-map';
      path: string;
      url: string;
      bytes: number;
      sha256: string;
    }
  | {
      kind: 'docs-ui-source';
      sourceMapPath: string;
      sourceUrl: string;
      sourceIndex: number;
      bytes: number;
      sha256: string;
      /** Attach these exact UTF-8 bytes separately; omit content from compact summaries. */
      content: string;
    };

function observations(traceEvents: unknown[]) {
  const points = new Map<string, Observation>();
  traceEvents.forEach((raw, index) => {
    if (
      !object(raw) ||
      (raw.name !== 'TimerInstall' && raw.name !== 'TimerRemove' && raw.name !== 'FunctionCall')
    )
      return;
    const data = object(raw.args) && object(raw.args.data) ? raw.args.data : null;
    const candidate =
      raw.name === 'FunctionCall'
        ? data
        : Array.isArray(data?.stackTrace)
          ? data.stackTrace[0]
          : null;
    const point = object(candidate)
      ? {
          url: candidate.url,
          lineNumber: candidate.lineNumber,
          columnNumber: candidate.columnNumber,
        }
      : null;
    // Invalid trace fields are retained as diagnostics and never normalized into
    // a usable callsite. Valid coordinates deduplicate across all three events.
    const key = JSON.stringify(point);
    const previous = points.get(key);
    if (previous) {
      previous.occurrences++;
      if (!previous.eventNames.includes(raw.name)) previous.eventNames.push(raw.name);
    } else {
      points.set(key, { point, firstEventIndex: index, occurrences: 1, eventNames: [raw.name] });
    }
  });
  return [...points.values()];
}

function validPoint(point: RawPoint | null): point is Point {
  return (
    point !== null &&
    typeof point.url === 'string' &&
    point.url.length > 0 &&
    offset(point.lineNumber) &&
    point.lineNumber > 0 &&
    offset(point.columnNumber) &&
    point.columnNumber > 0
  );
}

function packageClassifier(lines: string[]) {
  const region = (name: string) => {
    const starts = lines.flatMap((value, index) => (value === `//#region ${name}` ? [index] : []));
    if (starts.length !== 1) throw new Error(`Expected one package region for ${name}.`);
    const start = starts[0]!;
    const end = lines.findIndex((value, index) => index > start && value === '//#endregion');
    if (end < 0) throw new Error(`Package region ${name} is incomplete.`);
    return { start, end };
  };
  const cursor = region(cursorRegion);
  const zoom = region(zoomRegion);
  const method = (prefix: string) => {
    const matches = lines.flatMap((value, index) =>
      index > zoom.start && index < zoom.end && value.startsWith(`\t${prefix}`) ? [index] : [],
    );
    if (matches.length !== 1) throw new Error(`Expected one zoom ${prefix} method.`);
    return matches[0]!;
  };
  const constructor = method('constructor(');
  const skeleton = method('_initSkeletonListener() {');
  const commands = method('_initCommandExecutedListener() {');
  if (!(constructor < skeleton && skeleton < commands))
    throw new Error('Package zoom method boundaries are inconsistent.');
  return (line: number): DocCallbackAttribution => {
    if (line > cursor.start && line < cursor.end) return 'cursor';
    if (line >= constructor && line < skeleton) return 'zoom-init';
    if (line >= skeleton && line < commands) return 'zoom-update';
    return 'other';
  };
}

/**
 * Attribute Chrome timeline positions through the exact emitted build's maps.
 * Chrome positions stay unchanged in callsites; findEntry alone receives their
 * zero-based equivalents. Reported original source coordinates are one-based.
 * Missing mappings stay unclassified. No timer names, delays or counts are used.
 */
export async function attributeDocCallbackSources(input: {
  traceEvents: unknown[];
  origin: string;
  distDirectory: string;
}) {
  const origin = new URL(input.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw new Error('Expected an HTTP(S) build origin without credentials.');
  const directory = await realpath(input.distDirectory);
  const artifacts = new Map<string, DocCallbackSourceArtifact>();
  const callsites: DocCallbackCallsite[] = [];
  const unmapped: DocCallbackUnmappedSource[] = [];

  async function readBuildFile(path: string, kind: 'runtime' | 'source-map', url: string) {
    const actualPath = await realpath(path);
    if (!inside(directory, actualPath)) throw new Error(`${kind} resolves outside dist.`);
    const bytes = await readFile(actualPath);
    artifacts.set(`${kind}:${actualPath}`, {
      kind,
      path: actualPath,
      url,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
    return { path: actualPath, content: bytes.toString('utf8') };
  }

  async function loadMap(path: string, url: URL) {
    const runtime = await readBuildFile(path, 'runtime', url.href);
    const mapUrl = new URL(url);
    mapUrl.pathname += '.map';
    const mapFile = await readBuildFile(`${path}.map`, 'source-map', mapUrl.href);
    const payload: unknown = JSON.parse(mapFile.content);
    if (
      !object(payload) ||
      payload.version !== 3 ||
      typeof payload.mappings !== 'string' ||
      !Array.isArray(payload.sources) ||
      !payload.sources.every((source) => typeof source === 'string') ||
      new Set(payload.sources).size !== payload.sources.length ||
      !Array.isArray(payload.sourcesContent) ||
      payload.sourcesContent.length !== payload.sources.length ||
      !payload.sourcesContent.every((source) => typeof source === 'string' || source === null) ||
      (payload.names !== undefined &&
        (!Array.isArray(payload.names) ||
          !payload.names.every((name) => typeof name === 'string'))) ||
      (payload.file !== undefined &&
        (typeof payload.file !== 'string' || basename(payload.file) !== basename(path))) ||
      (payload.sourceRoot !== undefined && typeof payload.sourceRoot !== 'string')
    )
      throw new Error('Expected a complete, unambiguous version 3 map for this runtime file.');
    const sources = payload.sources as string[];
    const contents = payload.sourcesContent as Array<string | null>;
    const map = new SourceMap({
      version: 3,
      file: typeof payload.file === 'string' ? payload.file : basename(path),
      sourceRoot: typeof payload.sourceRoot === 'string' ? payload.sourceRoot : '',
      sources,
      // SourceMap uses coordinates only. Preserve null contents separately so
      // they remain mapping failures, rather than synthetic empty source files.
      sourcesContent: contents.map((content) => content ?? ''),
      names: (payload.names as string[] | undefined) ?? [],
      mappings: payload.mappings,
    });
    const sourceCache = new Map<
      number,
      { lines: string[]; classify: ((line: number) => DocCallbackAttribution) | null }
    >();
    function source(index: number) {
      const cached = sourceCache.get(index);
      if (cached) return cached;
      const content = contents[index];
      if (typeof content !== 'string') throw new Error('Mapped source content is missing.');
      const digest = sha256(content);
      const knownDocsUi = docsUiSources.has(digest);
      const sourceUrl = sources[index]!;
      const normalizedUrl = sourceUrl.replaceAll('\\', '/');
      const namedDocsUi =
        /(?:^|\/)@univerjs\/docs-ui\/lib\/(?:es|cjs)\/index\.js$/.test(normalizedUrl) ||
        normalizedUrl.endsWith(`/${cursorRegion}`) ||
        normalizedUrl.endsWith(`/${zoomRegion}`);
      if (knownDocsUi || namedDocsUi) {
        artifacts.set(`source:${mapFile.path}:${index}`, {
          kind: 'docs-ui-source',
          sourceMapPath: mapFile.path,
          sourceUrl,
          sourceIndex: index,
          bytes: Buffer.byteLength(content),
          sha256: digest,
          content,
        });
        if (!knownDocsUi)
          throw new Error('Mapped docs-ui content does not match the baseline or reviewed repair.');
      }
      const lines = content.split(/\r?\n/);
      const result = { lines, classify: knownDocsUi ? packageClassifier(lines) : null };
      sourceCache.set(index, result);
      return result;
    }
    return { map, sources, source, lines: runtime.content.split(/\r?\n/) };
  }
  const maps = new Map<string, ReturnType<typeof loadMap>>();
  for (const observation of observations(input.traceEvents)) {
    try {
      const point = observation.point;
      if (!validPoint(point))
        throw new Error('Expected a URL and positive integer Chrome line/column coordinates.');
      const url = new URL(point.url);
      if (url.origin !== origin.origin || url.username || url.password)
        throw new Error('Source URL is not on the measured build origin.');
      const pathname = decodeURIComponent(url.pathname);
      if (
        !pathname.endsWith('.js') ||
        /[\\\0]/.test(pathname) ||
        pathname.split('/').includes('..')
      )
        throw new Error('Source URL does not identify a generated JavaScript file inside dist.');
      const path = resolve(directory, `.${pathname}`);
      if (!inside(directory, path)) throw new Error('Generated source resolves outside dist.');
      let pending = maps.get(path);
      if (!pending) {
        pending = loadMap(path, url);
        maps.set(path, pending);
      }
      const build = await pending;
      const line = point.lineNumber - 1;
      const column = point.columnNumber - 1;
      if (line >= build.lines.length || column >= build.lines[line]!.length)
        throw new Error('Chrome position lies outside the generated runtime file.');
      const entry = build.map.findEntry(line, column);
      if (
        !('originalSource' in entry) ||
        entry.generatedLine !== line ||
        !offset(entry.originalLine) ||
        !offset(entry.originalColumn)
      )
        throw new Error('Generated position has no source mapping on its line.');
      const sourceIndex = build.sources.indexOf(entry.originalSource);
      if (sourceIndex < 0) throw new Error('Mapped source is absent from the map payload.');
      const source = build.source(sourceIndex);
      if (
        entry.originalLine >= source.lines.length ||
        entry.originalColumn > source.lines[entry.originalLine]!.length
      )
        throw new Error('Source mapping lies outside its original source content.');
      callsites.push({
        ...point,
        family: source.classify?.(entry.originalLine) ?? 'other',
        sourceUrl: entry.originalSource,
        sourceLine: entry.originalLine + 1,
        sourceColumn: entry.originalColumn + 1,
      });
    } catch (error) {
      unmapped.push({
        ...observation,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { callsites, unmapped, artifacts: [...artifacts.values()] };
}
