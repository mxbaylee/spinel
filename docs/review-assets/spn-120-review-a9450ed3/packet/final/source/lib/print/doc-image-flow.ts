/** Public-model image anchor projection using measured native geometry. */
import {
  NumberUnitType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
  SpacingRule,
} from '@univerjs/core';
import type { IDocDrawingBase, IDocumentBody, IDocumentData, IParagraph } from '@univerjs/core';
import { getNumberUnitValue } from '@univerjs/engine-render';
import type {
  IDocumentSkeletonCached,
  IDocumentSkeletonLine,
  IDocumentSkeletonPage,
} from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { imageBounds } from './image-render.ts';
import { moveImageAnchor } from './doc-image-anchor.ts';
import { inspectSnapshot } from './preflight.ts';

interface FlowEntry {
  drawing: IDocDrawingBase;
  paragraph: IParagraph;
  body: IDocumentBody;
  snapshot: IDocumentData;
  layoutType: PositionedObjectLayoutType;
  kind:
    'empty' | 'line-caption' | 'square-caption' | 'group' | 'terminal' | 'whitespace' | 'native';
  group?: { ids: string[] };
  carrier?: { drawing: IDocDrawingBase; baseline?: NonNullable<FlowEntry['baseline']> };
  baseline?: {
    left: number;
    top: number;
    width: number;
    height: number;
    angle: number;
    spaceBelow: number;
    span: number;
  };
}

export type ImageParagraphFlow = Map<string, FlowEntry>;

// These ordinary authored whitespace characters have distinct native line and
// tab metrics. Keep the characters/runs untouched; zero-width controls are not
// substitutes for this actual source content.
const typedWhitespace = new Set([' ', '\t', '\u00a0']);

function unsupported(): never {
  throw new PrintError(
    'unsupported',
    'PDF image paragraph flow could not be preserved completely.',
  );
}

/**
 * The native Traditional layout reflows an image-only Top-and-bottom anchor
 * below its own image, then uses that displaced line as the image origin. An
 * image-only Square anchor also drifts when its wrap rectangle covers the
 * whole column. A caption avoids the first bug, but adding text or hiding the
 * paragraph mark changes the saved document (hiding the mark also drops
 * paragraph-after spacing).
 *
 * For this exact source shape, first measure the real, unchanged paragraph
 * strut with the image positioned without wrapping. reserveImageParagraphFlow
 * then gives that existing empty paragraph the equivalent vertical reservation.
 * No authored text or paragraph spacing is removed. The source snapshot passed
 * by the caller has already been privately cloned, and every final image must
 * retain the measured appearance after equivalent positioning references change.
 * Captioned LINE references retain their original first-pass model so the
 * editor's compensated offsets can be measured before reference conversion.
 * Full-column Square text uses its existing image control as a leading native
 * Top-and-bottom anchor, retaining visible character order and style ranges.
 */
export function prepareImageParagraphFlow(
  snapshot: IDocumentData,
  check: () => void,
): ImageParagraphFlow {
  const result: ImageParagraphFlow = new Map();
  const bodies: IDocumentBody[] = [
    snapshot.body!,
    ...Object.values(snapshot.headers ?? {}).map((story) => story.body),
    ...Object.values(snapshot.footers ?? {}).map((story) => story.body),
  ];
  for (const body of bodies) {
    if (body === snapshot.body)
      for (const block of body.customBlocks ?? []) {
        check();
        const drawing = snapshot.drawings?.[block.blockId];
        // The editor's current wrap style owns layering. Its Behind -> wrap
        // command leaves this old flag behind, but its visible body painter
        // reads it only for WRAP_NONE. Native block stacking still reads the
        // stale flag, so normalize that inactive presentation state here.
        if (
          drawing?.behindDoc === 1 &&
          [
            PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
            PositionedObjectLayoutType.WRAP_SQUARE,
          ].includes(drawing.layoutType)
        )
          drawing.behindDoc = 0;
      }
    const paragraphs = new Map(
      (body.paragraphs ?? []).map((paragraph) => [paragraph.startIndex, paragraph]),
    );
    for (const block of body.customBlocks ?? []) {
      check();
      const drawing = snapshot.drawings?.[block.blockId];
      if (
        !drawing ||
        ![
          PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
          PositionedObjectLayoutType.WRAP_SQUARE,
        ].includes(drawing.layoutType)
      )
        continue;
      const anchor = block.startIndex;
      const end = body.dataStream.indexOf('\r', anchor);
      const paragraph = paragraphs.get(end);
      if (
        !paragraph ||
        ![ObjectRelativeFromV.PARAGRAPH, ObjectRelativeFromV.LINE].includes(
          drawing.docTransform.positionV.relativeFrom,
        ) ||
        drawing.docTransform.positionV.align !== undefined ||
        drawing.docTransform.positionV.percent !== undefined
      )
        continue;
      let paragraphStart = anchor;
      while (
        paragraphStart > 0 &&
        !['\r', '\n', '\x1c', '\x0f'].includes(body.dataStream[paragraphStart - 1])
      ) {
        check();
        paragraphStart--;
      }
      const siblings = (body.customBlocks ?? [])
        .filter((entry) => entry.startIndex >= paragraphStart && entry.startIndex < end)
        .sort((a, b) => a.startIndex - b.startIndex);
      if (
        siblings.length > 1 &&
        siblings.every((entry, index) => {
          const image = snapshot.drawings?.[entry.blockId];
          const position = image?.docTransform.positionV;
          return (
            entry.startIndex === paragraphStart + index &&
            image &&
            position &&
            image.hidden !== true &&
            (image.layoutType === PositionedObjectLayoutType.WRAP_NONE ||
              (image.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM &&
                image.behindDoc !== 1 &&
                [ObjectRelativeFromV.PARAGRAPH, ObjectRelativeFromV.LINE].includes(
                  position.relativeFrom,
                ) &&
                position.align === undefined &&
                position.percent === undefined &&
                (position.posOffset ?? 0) >= 0))
          );
        }) &&
        !paragraph.bullet &&
        !Object.keys(paragraph.paragraphStyle ?? {}).some((key) => key.startsWith('border'))
      ) {
        if (paragraphStart + siblings.length === end) {
          const wrapping = siblings.filter(
            ({ blockId }) =>
              snapshot.drawings![blockId].layoutType ===
              PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
          );
          const group = { ids: wrapping.map((entry) => entry.blockId) };
          for (const sibling of wrapping) {
            const image = snapshot.drawings![sibling.blockId];
            const layoutType = image.layoutType;
            image.layoutType = PositionedObjectLayoutType.WRAP_NONE;
            result.set(sibling.blockId, {
              drawing: image,
              paragraph,
              body,
              snapshot,
              layoutType,
              kind: 'group',
              group,
            });
          }
          continue;
        }
      }
      const empty =
        end === anchor + 1 &&
        (anchor === 0 || ['\r', '\n', '\x1c', '\x0f'].includes(body.dataStream[anchor - 1]));
      const previous = siblings.find((entry) => entry.startIndex === anchor - 1);
      const carrier = previous && snapshot.drawings?.[previous.blockId];
      const prefix = body.dataStream.slice(paragraphStart, anchor);
      const suffix = body.dataStream.slice(anchor + 1, end);
      const whitespaceTerminal =
        !paragraph.bullet &&
        [...suffix].every((character) => typedWhitespace.has(character)) &&
        (/[^\s\p{C}\uFFFC]/u.test(prefix) ||
          [...prefix].every((character) => character === '\b' || typedWhitespace.has(character))) &&
        [...prefix, ...suffix].some((character) => typedWhitespace.has(character));
      if (
        drawing.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM &&
        (end === anchor + 1 || whitespaceTerminal) &&
        (/[^\s\p{C}\uFFFC]/u.test(prefix) ||
          whitespaceTerminal ||
          siblings.some(
            ({ blockId }) =>
              snapshot.drawings?.[blockId]?.layoutType === PositionedObjectLayoutType.INLINE,
          )) &&
        siblings.every(({ blockId }) => {
          const image = snapshot.drawings?.[blockId];
          const position = image?.docTransform.positionV;
          return (
            image &&
            position &&
            image.hidden !== true &&
            image.behindDoc !== 1 &&
            (image.layoutType === PositionedObjectLayoutType.INLINE ||
              (image.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM &&
                [ObjectRelativeFromV.PARAGRAPH, ObjectRelativeFromV.LINE].includes(
                  position.relativeFrom,
                ) &&
                position.align === undefined &&
                position.percent === undefined &&
                Number.isFinite(position.posOffset)))
          );
        })
      ) {
        result.set(block.blockId, {
          drawing,
          paragraph,
          body,
          snapshot,
          layoutType: drawing.layoutType,
          kind: whitespaceTerminal ? 'whitespace' : 'terminal',
          ...(carrier?.layoutType === PositionedObjectLayoutType.INLINE
            ? { carrier: { drawing: carrier } }
            : {}),
        });
        continue;
      }
      if (!empty) {
        const following = (body.customBlocks ?? [])
          .filter((entry) => entry.startIndex > anchor && entry.startIndex < end)
          .map((entry) => snapshot.drawings?.[entry.blockId]);
        const inlineContent = following.some(
          (image) =>
            image?.layoutType === PositionedObjectLayoutType.INLINE && image.hidden !== true,
        );
        if (
          drawing.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM &&
          drawing.docTransform.positionV.relativeFrom === ObjectRelativeFromV.LINE &&
          following.every(
            (image) =>
              image &&
              [
                PositionedObjectLayoutType.INLINE,
                PositionedObjectLayoutType.WRAP_NONE,
                PositionedObjectLayoutType.WRAP_SQUARE,
                PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM,
              ].includes(image.layoutType),
          ) &&
          (/[^\s\p{C}\uFFFC]/u.test(suffix) ||
            inlineContent ||
            ([...suffix].some((character) => typedWhitespace.has(character)) &&
              [...suffix].every(
                (character) => character === '\b' || typedWhitespace.has(character),
              )) ||
            following.some((image) => image?.layoutType === PositionedObjectLayoutType.WRAP_SQUARE))
        )
          result.set(block.blockId, {
            drawing,
            paragraph,
            body,
            snapshot,
            layoutType: drawing.layoutType,
            kind: 'line-caption',
          });
        else if (
          drawing.layoutType === PositionedObjectLayoutType.WRAP_SQUARE &&
          /[^\s\p{C}\uFFFC]/u.test(body.dataStream.slice(paragraphStart, end)) &&
          siblings.length === 1
        ) {
          const layoutType = drawing.layoutType;
          drawing.layoutType = PositionedObjectLayoutType.WRAP_NONE;
          result.set(block.blockId, {
            drawing,
            paragraph,
            body,
            snapshot,
            layoutType,
            kind: 'square-caption',
          });
        }
        continue;
      }
      // A list marker or a paragraph border has its own painted line geometry;
      // it is not an empty image paragraph and must keep the normal native path.
      if (
        paragraph.bullet ||
        Object.keys(paragraph.paragraphStyle ?? {}).some((key) => key.startsWith('border'))
      )
        continue;
      const layoutType = drawing.layoutType;
      if ((drawing.docTransform.positionV.posOffset ?? 0) < 0 || (drawing.distT ?? 0) > 0) {
        // These authored exclusions reach back into preceding flow. The native
        // wrapping pass owns that reflow; a forward-only empty-line reservation
        // would remove it. Keep the source model and verify its complete native
        // image geometry and separation after every subsequent layout.
        result.set(block.blockId, {
          drawing,
          paragraph,
          body,
          snapshot,
          layoutType,
          kind: 'native',
        });
        continue;
      }
      drawing.layoutType = PositionedObjectLayoutType.WRAP_NONE;
      result.set(block.blockId, { drawing, paragraph, body, snapshot, layoutType, kind: 'empty' });
    }
  }
  return result;
}

/** These anchors need their first complete layout before measured normalization. */
export function pendingImageLineAnchors(flow: ImageParagraphFlow): ReadonlySet<string> {
  return new Set(
    [...flow]
      .filter(([, entry]) =>
        ['line-caption', 'terminal', 'whitespace', 'native'].includes(entry.kind),
      )
      .map(([id]) => id),
  );
}

interface NativeLine {
  page: IDocumentSkeletonPage;
  line: IDocumentSkeletonLine;
  top: number;
  columnLeft: number;
  columnWidth: number;
}

interface NativeAnchor extends NativeLine {
  paragraphFirst: NativeLine;
  paragraphLast: NativeLine;
}

function anchors(
  data: IDocumentSkeletonCached,
  flow: ImageParagraphFlow,
  check: () => void,
): Map<string, NativeAnchor[]> {
  const result = new Map<string, NativeAnchor[]>();
  const paragraphs = new Map<string, NativeLine[]>();
  const scopes = new Map<NativeAnchor, string>();
  const tracked = new Set([
    ...flow.keys(),
    ...[...flow.values()].flatMap((entry) =>
      entry.carrier ? [entry.carrier.drawing.drawingId] : [],
    ),
  ]);
  const visited = new Set<IDocumentSkeletonPage>();
  const walk = (page: IDocumentSkeletonPage, depth: number, scope: string) => {
    check();
    if (visited.has(page)) return;
    visited.add(page);
    if (depth > 32 || page.isLayoutPlaceholder || page.isMaterializationPlaceholder) unsupported();
    for (const section of page.sections)
      for (const column of section.columns)
        for (const line of column.lines) {
          check();
          const point: NativeLine = {
            page,
            line,
            top: section.top + line.top,
            columnLeft: column.left,
            columnWidth: column.width,
          };
          const key = `${scope}:${line.paragraphIndex}`;
          const lines = paragraphs.get(key) ?? [];
          lines.push(point);
          paragraphs.set(key, lines);
          const ids = new Set(
            line.divides.flatMap((divide) => divide.glyphGroup.map((glyph) => glyph.drawingId)),
          );
          for (const id of ids)
            if (id && tracked.has(id)) {
              const values = result.get(id) ?? [];
              const anchor = { ...point, paragraphFirst: point, paragraphLast: point };
              values.push(anchor);
              scopes.set(anchor, key);
              result.set(id, values);
            }
        }
    for (const table of page.skeTables.values())
      for (const row of table.rows) for (const cell of row.cells) walk(cell, depth + 1, scope);
    for (const group of page.skeColumnGroups.values())
      for (const column of group.columns) walk(column.page, depth + 1, scope);
  };
  for (const page of data.pages) walk(page, 0, 'body');
  for (const [kind, stories] of [data.skeHeaders, data.skeFooters].entries())
    for (const [id, layouts] of stories)
      for (const [width, page] of layouts) walk(page, 0, JSON.stringify([kind, id, width]));
  for (const [id, values] of result)
    for (const anchor of values) {
      const lines = paragraphs.get(scopes.get(anchor)!)!;
      anchor.paragraphFirst = lines[0];
      anchor.paragraphLast =
        lines.findLast(({ line }) =>
          line.divides.some((divide) =>
            divide.glyphGroup.some((glyph) => (glyph.raw ?? glyph.streamType) === '\r'),
          ),
        ) ?? lines.at(-1)!;
      if (['square-caption', 'group'].includes(flow.get(id)?.kind ?? ''))
        Object.assign(anchor, anchor.paragraphFirst);
    }
  return result;
}

function geometry(entry: Pick<FlowEntry, 'drawing'>, anchor: NativeAnchor) {
  const drawing = anchor.page.skeDrawings.get(entry.drawing.drawingId);
  if (!drawing) unsupported();
  const appearance = {
    left: drawing.aLeft,
    top: drawing.aTop,
    width: drawing.width,
    height: drawing.height,
    angle: drawing.angle ?? 0,
    flipX: entry.drawing.docTransform.flipX ?? false,
    flipY: entry.drawing.docTransform.flipY ?? false,
  };
  const bounds = imageBounds(appearance);
  if (!bounds) unsupported();
  return { appearance, bounds };
}

function rememberBaseline(
  entry: Pick<FlowEntry, 'baseline'>,
  baseline: NonNullable<FlowEntry['baseline']>,
) {
  if (!Object.values(baseline).every(Number.isFinite)) unsupported();
  if (
    entry.baseline &&
    Object.keys(baseline).some(
      (key) =>
        Math.abs(
          baseline[key as keyof typeof baseline] - entry.baseline![key as keyof typeof baseline],
        ) > 0.01,
    )
  )
    unsupported();
  entry.baseline = baseline;
}

/** Return true only when another complete native layout is required. */
export function reserveImageParagraphFlow(
  flow: ImageParagraphFlow,
  data: IDocumentSkeletonCached,
  limits: Readonly<PrintLimits>,
  check: () => void,
): boolean {
  if (!flow.size) return false;
  const snapshot = flow.values().next().value!.snapshot;
  const found = anchors(data, flow, check);
  let changed = false;
  for (const [id, entry] of flow) {
    check();
    const values = found.get(id);
    if (!values?.length) unsupported();
    if (entry.kind === 'native') {
      for (const anchor of values) {
        const { appearance } = geometry(entry, anchor);
        rememberBaseline(entry, {
          left: appearance.left,
          top: appearance.top - anchor.top,
          width: appearance.width,
          height: appearance.height,
          angle: appearance.angle,
          spaceBelow: anchor.line.spaceBelowApply,
          span: anchor.line.contentHeight + anchor.line.paddingTop + anchor.line.paddingBottom,
        });
      }
      continue;
    }
    if (entry.carrier) {
      let reservation:
        { bottom: number; offset: number; before: number; after: number } | undefined;
      for (const [index, anchor] of values.entries()) {
        const inline = found.get(entry.carrier.drawing.drawingId)?.[index];
        if (!inline || inline.page !== anchor.page) unsupported();
        const { appearance } = geometry(entry, anchor);
        const first = geometry(entry.carrier, inline).appearance;
        const native = inline.page.skeDrawings.get(entry.carrier.drawing.drawingId)!;
        const line = inline.line;
        const span = line.contentHeight + line.paddingTop + line.paddingBottom;
        const displacement =
          entry.drawing.docTransform.positionV.relativeFrom === ObjectRelativeFromV.LINE &&
          entry.drawing.docTransform.positionV.posOffset === 0
            ? 0
            : appearance.top - anchor.top;
        const top = line.marginTop + span + displacement;
        const bounds = imageBounds({ ...appearance, top: inline.top + top });
        if (!bounds) unsupported();
        const required = bounds.bottom - inline.top + (entry.drawing.distB ?? 0);
        // Adjacent INLINE controls are one native glyph group. Growing its
        // descent preserves the original ascent, first image and prefix baseline,
        // while reserving the terminal floating image below the complete line.
        const next = {
          bottom: Math.max(
            line.dsc,
            required - line.marginTop - line.paddingTop - line.paddingBottom - line.asc,
          ),
          offset: inline.top + top - native.blockAnchorTop,
          before: inline.paragraphFirst.line.marginTop,
          after: anchor.line.spaceBelowApply,
        };
        if (!Object.values(next).every(Number.isFinite) || next.bottom < 0) unsupported();
        if (required > Math.max(...data.pages.map((page) => page.pageHeight)) * limits.pages)
          throw new PrintError('limit', 'PDF image flow exceeds its page budget.');
        if (
          reservation &&
          Object.entries(next).some(
            ([key, value]) => Math.abs(value - reservation![key as keyof typeof next]) > 0.01,
          )
        )
          unsupported();
        reservation = next;
        rememberBaseline(entry, {
          left: appearance.left,
          top,
          width: appearance.width,
          height: appearance.height,
          angle: appearance.angle,
          spaceBelow: next.after,
          span,
        });
        rememberBaseline(entry.carrier, {
          left: first.left,
          top: first.top - inline.top,
          width: first.width,
          height: first.height,
          angle: first.angle,
          spaceBelow: next.after,
          span,
        });
      }
      entry.carrier.drawing.effectExtent = { bottom: reservation!.bottom };
      entry.drawing.layoutType = PositionedObjectLayoutType.WRAP_NONE;
      entry.drawing.docTransform.positionV = {
        relativeFrom: ObjectRelativeFromV.PARAGRAPH,
        posOffset: reservation!.offset,
      };
      entry.paragraph.paragraphStyle = {
        ...entry.paragraph.paragraphStyle,
        spaceAbove: { v: reservation!.before, u: NumberUnitType.PIXEL },
        spaceBelow: { v: reservation!.after, u: NumberUnitType.PIXEL },
      };
      changed = true;
      continue;
    }
    if (entry.kind === 'terminal' || entry.kind === 'whitespace') {
      let extent: IDocDrawingBase['effectExtent'];
      let spacing: { before: number; after: number } | undefined;
      for (const anchor of values) {
        const { appearance, bounds } = geometry(entry, anchor);
        const divide = anchor.line.divides[0];
        if (anchor.line.divides.length !== 1 || !divide) unsupported();
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        const top =
          entry.drawing.docTransform.positionV.relativeFrom === ObjectRelativeFromV.LINE &&
          entry.drawing.docTransform.positionV.posOffset === 0
            ? 0
            : appearance.top - anchor.top;
        // The last floating control and paragraph mark otherwise form a real
        // text strut, triggering native own-height displacement. Give only that
        // existing control a full-width inline layout box. Public effect extents
        // supply layout padding; native image size, rotation and source stay intact.
        const left =
          appearance.left -
          anchor.columnLeft -
          divide.left -
          divide.paddingLeft -
          (width - appearance.width) / 2;
        const projected = {
          left,
          right: divide.width - width - left,
          top: top - (height - appearance.height) / 2,
          bottom: entry.drawing.distB ?? 0,
        };
        if (
          !Object.values(projected).every(Number.isFinite) ||
          projected.left < -0.01 ||
          projected.right < -0.01 ||
          width <= 0 ||
          height <= 0
        )
          unsupported();
        if (
          extent &&
          Object.entries(projected).some(
            ([key, value]) =>
              Math.abs(value - (extent![key as keyof typeof projected] ?? 0)) > 0.01,
          )
        )
          unsupported();
        extent = projected;
        if (entry.kind === 'whitespace') {
          const next = {
            before: anchor.paragraphFirst.line.marginTop,
            after: anchor.paragraphLast.line.spaceBelowApply,
          };
          if (
            !Object.values(next).every(Number.isFinite) ||
            (spacing &&
              Object.entries(next).some(
                ([key, value]) => Math.abs(value - spacing![key as keyof typeof next]) > 0.01,
              ))
          )
            unsupported();
          spacing = next;
        }
        rememberBaseline(entry, {
          left: appearance.left,
          top,
          width: appearance.width,
          height: appearance.height,
          angle: appearance.angle,
          spaceBelow: spacing?.after ?? anchor.line.spaceBelowApply,
          span: anchor.line.contentHeight + anchor.line.paddingTop + anchor.line.paddingBottom,
        });
      }
      entry.drawing.layoutType = PositionedObjectLayoutType.INLINE;
      entry.drawing.effectExtent = extent;
      if (spacing) {
        // The actual spaces, tabs, runs and source offsets remain native. The
        // larger inline image strut must not scale authored relative paragraph
        // spacing; retain the first/last native spacing measured before it.
        entry.paragraph.paragraphStyle = {
          ...entry.paragraph.paragraphStyle,
          spaceAbove: { v: spacing.before, u: NumberUnitType.PIXEL },
          spaceBelow: { v: spacing.after, u: NumberUnitType.PIXEL },
        };
      }
      changed = true;
      continue;
    }
    if (entry.group) {
      if (id !== entry.group.ids[0]) continue;
      let required = 0,
        originalSpan = 0,
        marginTop = 0;
      for (const [index, first] of values.entries()) {
        let cursor = 0;
        const original = first.paragraphFirst;
        originalSpan = Math.max(
          originalSpan,
          original.line.contentHeight + original.line.paddingTop + original.line.paddingBottom,
        );
        marginTop = Math.max(marginTop, original.line.marginTop);
        for (const memberId of entry.group.ids) {
          const member = flow.get(memberId)!;
          const anchor = found.get(memberId)?.[index];
          if (!anchor || anchor.page !== first.page || Math.abs(anchor.top - first.top) > 0.01)
            unsupported();
          const { appearance } = geometry(member, anchor);
          // Public Top-and-bottom blocks deliberately stack in source order:
          // each next anchor follows the preceding native image flow bottom.
          // Measure common paragraph origin first, then retain that cumulative
          // stack in one reservation instead of repeating the native drift.
          const top = cursor + appearance.top - first.top;
          const bounds = imageBounds({ ...appearance, top: first.top + top });
          if (!bounds) unsupported();
          cursor = top + appearance.height + (member.drawing.distB ?? 0);
          required = Math.max(
            required,
            cursor,
            bounds.bottom - first.top + (member.drawing.distB ?? 0),
          );
          rememberBaseline(member, {
            left: appearance.left,
            top,
            width: appearance.width,
            height: appearance.height,
            angle: appearance.angle,
            spaceBelow: anchor.paragraphLast.line.spaceBelowApply,
            span: originalSpan,
          });
        }
      }
      const maximum = Math.max(...data.pages.map((page) => page.pageHeight)) * limits.pages;
      if (!Number.isFinite(required) || required > maximum)
        throw new PrintError('limit', 'PDF image flow exceeds its page budget.');
      for (const memberId of entry.group.ids) {
        const member = flow.get(memberId)!;
        member.drawing.docTransform.positionV.posOffset = member.baseline!.top;
      }
      const style = entry.paragraph.paragraphStyle ?? {};
      const absolute = (value: typeof style.spaceAbove) =>
        value == null
          ? undefined
          : { v: getNumberUnitValue(value, originalSpan), u: NumberUnitType.PIXEL };
      entry.paragraph.paragraphStyle = {
        ...style,
        lineSpacing: Math.max(originalSpan, required - marginTop),
        spacingRule: SpacingRule.EXACT,
        ...(style.spaceAbove == null ? {} : { spaceAbove: absolute(style.spaceAbove) }),
        ...(style.spaceBelow == null ? {} : { spaceBelow: absolute(style.spaceBelow) }),
      };
      changed = true;
      continue;
    }
    if (entry.kind === 'line-caption') {
      let horizontal: number | undefined;
      for (const anchor of values) {
        const { appearance } = geometry(entry, anchor);
        // Top-and-bottom puts its block on a separate zero-height native line.
        // LINE zero therefore shares that line's paragraph anchor. The pinned
        // native LINE relayout can retain a stale, lower drawing.lineTop after
        // moving the caption; use the actual source anchor for this exact zero
        // case. Nonzero offsets can include the editor's compensation when its
        // reference menu changes, so preserve their measured image origin.
        const top =
          entry.drawing.docTransform.positionV.posOffset === 0 ? 0 : appearance.top - anchor.top;
        const baseline = {
          left: appearance.left,
          top,
          width: appearance.width,
          height: appearance.height,
          angle: appearance.angle,
          spaceBelow: anchor.line.spaceBelowApply,
          span: anchor.line.contentHeight + anchor.line.paddingTop + anchor.line.paddingBottom,
        };
        rememberBaseline(entry, baseline);
        const pageLeft = appearance.left + anchor.page.marginLeft;
        if (horizontal !== undefined && Math.abs(pageLeft - horizontal) > 0.01) unsupported();
        horizontal = pageLeft;
      }
      const transform = entry.drawing.docTransform;
      if (transform.positionH.relativeFrom === ObjectRelativeFromH.COLUMN)
        transform.positionH = {
          relativeFrom: ObjectRelativeFromH.PAGE,
          posOffset: horizontal!,
        };
      transform.positionV = {
        relativeFrom: ObjectRelativeFromV.PARAGRAPH,
        posOffset: entry.baseline!.top,
      };
      changed = true;
      continue;
    }
    if (entry.layoutType === PositionedObjectLayoutType.WRAP_SQUARE) {
      const covers = values.map((anchor) => {
        const { bounds } = geometry(entry, anchor);
        return (
          bounds.left - (entry.drawing.distL ?? 0) <= anchor.columnLeft + 0.01 &&
          bounds.right + (entry.drawing.distR ?? 0) >= anchor.columnLeft + anchor.columnWidth - 0.01
        );
      });
      // Only a wrap rectangle covering both column edges is equivalent to a
      // full vertical reservation. A narrow Square image keeps native side
      // wrapping after this measurement pass, including its original strut.
      if (covers.every((value) => !value)) {
        entry.drawing.layoutType = entry.layoutType;
        flow.delete(id);
        changed = true;
        continue;
      }
      if (!covers.every(Boolean)) unsupported();
    }
    if (entry.kind === 'square-caption') {
      let horizontal: number | undefined;
      for (const anchor of values) {
        const { appearance } = geometry(entry, anchor);
        const span = anchor.line.contentHeight + anchor.line.paddingTop + anchor.line.paddingBottom;
        rememberBaseline(entry, {
          left: appearance.left,
          top: appearance.top - anchor.top,
          width: appearance.width,
          height: appearance.height,
          angle: appearance.angle,
          spaceBelow: anchor.paragraphLast.line.spaceBelowApply,
          span,
        });
        const left = appearance.left + anchor.page.marginLeft;
        if (horizontal !== undefined && Math.abs(left - horizontal) > 0.01) unsupported();
        horizontal = left;
      }
      let start = entry.paragraph.startIndex;
      while (
        start > 0 &&
        !['\r', '\n', '\x1c', '\x0f'].includes(entry.body.dataStream[start - 1])
      ) {
        check();
        start--;
      }
      moveImageAnchor(entry.body, id, start, check);
      const style = entry.paragraph.paragraphStyle ?? {};
      if (style.spaceAbove != null)
        entry.paragraph.paragraphStyle = {
          ...style,
          spaceAbove: {
            v: getNumberUnitValue(style.spaceAbove, entry.baseline!.span),
            u: NumberUnitType.PIXEL,
          },
        };
      entry.drawing.layoutType = PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM;
      entry.drawing.docTransform.positionH = {
        relativeFrom: ObjectRelativeFromH.PAGE,
        posOffset: horizontal!,
      };
      entry.drawing.docTransform.positionV = {
        relativeFrom: ObjectRelativeFromV.PARAGRAPH,
        posOffset: entry.baseline!.top,
      };
      changed = true;
      continue;
    }
    let span = 0;
    let baselineSpan = 0;
    for (const anchor of values) {
      const { line, top } = anchor;
      const { appearance, bounds } = geometry(entry, anchor);
      const originalSpan = line.contentHeight + line.paddingTop + line.paddingBottom;
      const requiredSpan = bounds.bottom + (entry.drawing.distB ?? 0) - top - line.marginTop;
      if (![originalSpan, requiredSpan].every(Number.isFinite) || originalSpan < 0) unsupported();
      span = Math.max(span, originalSpan, requiredSpan);
      baselineSpan = Math.max(baselineSpan, originalSpan);
      const baseline = {
        left: appearance.left,
        top: appearance.top - top,
        width: appearance.width,
        height: appearance.height,
        angle: appearance.angle,
        spaceBelow: line.spaceBelowApply,
        span: originalSpan,
      };
      rememberBaseline(entry, baseline);
    }
    const maximum = Math.max(...data.pages.map((page) => page.pageHeight)) * limits.pages;
    if (!Number.isFinite(span) || span > maximum)
      throw new PrintError('limit', 'PDF image flow exceeds its page budget.');
    if (span <= baselineSpan + 0.001) continue;
    const style = entry.paragraph.paragraphStyle ?? {};
    // Relative paragraph spacing is measured against the original native strut,
    // not the enlarged image reservation. Resolve it before changing line height.
    const absolute = (value: typeof style.spaceAbove) =>
      value == null
        ? undefined
        : {
            v: getNumberUnitValue(value, baselineSpan),
            u: NumberUnitType.PIXEL,
          };
    entry.paragraph.paragraphStyle = {
      ...style,
      lineSpacing: span,
      spacingRule: SpacingRule.EXACT,
      ...(style.spaceAbove == null ? {} : { spaceAbove: absolute(style.spaceAbove) }),
      ...(style.spaceBelow == null ? {} : { spaceBelow: absolute(style.spaceBelow) }),
    };
    changed = true;
  }
  if (changed) inspectSnapshot(snapshot, limits, check);
  return changed;
}

/** Top-level body image paragraphs eligible for finite-page source continuation. */
export function bodyImageFlowParagraphs(
  snapshot: IDocumentData,
  check: () => void,
): readonly number[] {
  const body = snapshot.body!;
  const paragraphs = new Set((body.paragraphs ?? []).map((entry) => entry.startIndex));
  const result = new Set<number>();
  for (const block of body.customBlocks ?? []) {
    check();
    if (!snapshot.drawings?.[block.blockId]) continue;
    if (
      body.tables?.some((range) => {
        check();
        return block.startIndex >= range.startIndex && block.startIndex < range.endIndex;
      })
    )
      continue;
    const end = body.dataStream.indexOf('\r', block.startIndex);
    if (paragraphs.has(end)) result.add(end);
  }
  return [...result].sort((a, b) => a - b);
}

/** The final native model must retain the measured origin, spacing and full image reservation. */
export function verifyImageParagraphFlow(
  flow: ImageParagraphFlow,
  data: IDocumentSkeletonCached,
  check: () => void,
): void {
  if (!flow.size) return;
  const found = anchors(data, flow, check);
  for (const [id, entry] of flow) {
    const baseline = entry.baseline;
    const values = found.get(id);
    if (!baseline || !values?.length) unsupported();
    if (entry.carrier) {
      const prior = entry.carrier.baseline;
      const positions = found.get(entry.carrier.drawing.drawingId);
      if (!prior || !positions?.length) unsupported();
      for (const inline of positions) {
        const { appearance } = geometry(entry.carrier, inline);
        if (
          [
            appearance.left - prior.left,
            appearance.top - inline.top - prior.top,
            appearance.width - prior.width,
            appearance.height - prior.height,
            appearance.angle - prior.angle,
          ].some((value) => Math.abs(value) > 0.01)
        )
          unsupported();
      }
    }
    for (const anchor of values) {
      check();
      const { appearance, bounds } = geometry(entry, anchor);
      const actual = [
        appearance.left,
        appearance.top - anchor.top,
        appearance.width,
        appearance.height,
        appearance.angle,
        entry.kind === 'square-caption' || entry.kind === 'whitespace' || entry.group
          ? anchor.paragraphLast.line.spaceBelowApply
          : anchor.line.spaceBelowApply,
      ];
      const expected = [
        baseline.left,
        baseline.top,
        baseline.width,
        baseline.height,
        baseline.angle,
        baseline.spaceBelow,
      ];
      if (actual.some((value, index) => Math.abs(value - expected[index]) > 0.01)) unsupported();
      if (
        entry.kind === 'empty' ||
        entry.kind === 'terminal' ||
        entry.kind === 'whitespace' ||
        entry.group
      ) {
        const bottom = anchor.top + anchor.line.lineHeight - (anchor.line.marginBottom ?? 0);
        if (bottom + 0.01 < bounds.bottom + (entry.drawing.distB ?? 0)) unsupported();
      }
      // A negative offset or top-wrap distance can reach earlier text. Forward
      // reservation cannot reproduce that collision's required backward reflow;
      // never quietly turn it into an overlapping non-wrapping image.
      for (const section of anchor.page.sections)
        for (const column of section.columns) {
          if (bounds.right <= column.left || bounds.left >= column.left + column.width) continue;
          for (const line of column.lines) {
            check();
            if (line === anchor.line && !entry.carrier) continue;
            const contentOnly = Boolean(entry.group || entry.carrier);
            const top =
              section.top +
              line.top +
              (contentOnly
                ? line.marginTop +
                  // The retained carrier span already includes its native padding.
                  (line === anchor.line && entry.carrier ? 0 : line.paddingTop)
                : 0);
            const height =
              line === anchor.line && entry.carrier
                ? entry.carrier.baseline!.span
                : contentOnly
                  ? line.contentHeight
                  : line.lineHeight;
            if (
              top + height <= bounds.top - (entry.drawing.distT ?? 0) + 0.01 ||
              top >= bounds.bottom + (entry.drawing.distB ?? 0) - 0.01
            )
              continue;
            if (
              line.divides.some((divide) =>
                divide.glyphGroup.some((glyph) => /[^\s\p{C}]/u.test(glyph.content)),
              )
            )
              unsupported();
          }
        }
    }
  }
}
