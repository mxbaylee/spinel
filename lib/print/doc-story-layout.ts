/** Validate and paint each native header/footer in its own source coordinate space. */
import type { IDocumentData } from '@univerjs/core';
import type { IDocumentSkeletonCached, IDocumentSkeletonPage } from '@univerjs/engine-render';
import type { PrintBox, PrintLimits } from './contract.ts';
import { PrintError } from './contract.ts';
import type { PreparedFonts } from './fonts.ts';
import { paginateDocument } from './doc-layout.ts';
import type { DocPlacedImage } from './doc-layout.ts';
import { docStories } from './doc-stories.ts';

export interface DocInk {
  bounds: PrintBox | null;
  text: PrintBox[];
  horizontal: PrintBox[];
}

export interface DocStoryPaint {
  page: IDocumentSkeletonPage;
  images: DocPlacedImage[];
  resources: Pick<IDocumentSkeletonCached, 'skeHeaders' | 'skeFooters'>;
}

export function bodyOnlyPage(page: IDocumentSkeletonPage): IDocumentSkeletonPage {
  return { ...page, headerId: '', footerId: '' };
}

export function prepareDocStoryPaints(
  snapshot: IDocumentData,
  data: IDocumentSkeletonCached,
  fonts: PreparedFonts,
  limits: Readonly<PrintLimits>,
  check: () => void,
  measure: (page: IDocumentSkeletonPage, resources: DocStoryPaint['resources']) => DocInk,
  budget: { nodes: number; paintWork: number },
): Map<IDocumentSkeletonPage, DocStoryPaint[]> {
  const sources = new Map(
    docStories(snapshot, false)
      .filter((story) => story.kind !== 'body')
      .map((story) => [story.id, story]),
  );
  const output = new Map<IDocumentSkeletonPage, DocStoryPaint[]>();
  for (const root of data.pages) {
    check();
    const paints: DocStoryPaint[] = [];
    for (const kind of ['header', 'footer'] as const) {
      const id = kind === 'header' ? root.headerId : root.footerId;
      if (!id) continue;
      const source = sources.get(id);
      const page = (kind === 'header' ? data.skeHeaders : data.skeFooters)
        .get(id)
        ?.get((kind === 'header' ? root.headerLayoutKey : root.footerLayoutKey) ?? root.pageWidth);
      if (!source || source.kind !== kind || !page)
        throw new PrintError('unsupported', 'PDF header or footer layout is unavailable.');
      const rendered: IDocumentSkeletonPage = {
        ...root,
        sections: [],
        skeTables: new Map(),
        skeDrawings: new Map(),
        skeColumnGroups: new Map(),
        headerId: kind === 'header' ? id : '',
        footerId: kind === 'footer' ? id : '',
      };
      const resources = {
        skeHeaders: new Map(data.skeHeaders),
        skeFooters: new Map(data.skeFooters),
      };
      const layouts = new Map((kind === 'header' ? data.skeHeaders : data.skeFooters).get(id)!);
      // Native story layout stores only the content width, while its public
      // painter adds the parent page's margins to the table viewport. Present
      // the physical width for painting so those margins are deducted once.
      // All shaped lines, cells and drawing coordinates remain unchanged.
      layouts.set(
        (kind === 'header' ? root.headerLayoutKey : root.footerLayoutKey) ?? root.pageWidth,
        { ...page, pageWidth: root.pageWidth },
      );
      (kind === 'header' ? resources.skeHeaders : resources.skeFooters).set(id, layouts);
      const ink = measure(rendered, resources);
      const top =
        kind === 'header' ? page.marginTop : root.pageHeight - page.height - page.marginBottom;
      const bodyEdge = kind === 'header' ? root.marginTop : root.pageHeight - root.marginBottom;
      if (
        !Number.isFinite(top) ||
        top < 0 ||
        page.height < 0 ||
        top + page.height > root.pageHeight + 0.01 ||
        (kind === 'header' ? top + page.height > bodyEdge + 0.01 : top < bodyEdge - 0.01) ||
        (ink.bounds &&
          (ink.bounds.left < -0.01 ||
            ink.bounds.right > root.pageWidth + 0.01 ||
            ink.bounds.top < -0.01 ||
            ink.bounds.bottom > root.pageHeight + 0.01 ||
            (kind === 'header'
              ? ink.bounds.bottom > bodyEdge + 0.01
              : ink.bounds.top < bodyEdge - 0.01)))
      )
        throw new PrintError('unsupported', 'PDF header or footer exceeds its page reservation.');
      const frame = {
        width: root.pageWidth,
        height: root.pageHeight,
        left: root.marginLeft,
        right: root.marginRight,
        top,
        // The body reservation, rather than the header's line box alone,
        // includes native border/decoration ink and empty paragraph spacing.
        bottom: kind === 'header' ? root.pageHeight - bodyEdge : 0,
      };
      const slices = paginateDocument(
        source.snapshot,
        { ...data, pages: [page] },
        frame,
        fonts,
        limits,
        check,
        new Map([[page, ink]]),
        false,
        budget,
      );
      if (slices.length !== 1)
        throw new PrintError('unsupported', 'PDF header or footer layout is incomplete.');
      paints.push({ page: rendered, images: slices[0].images, resources });
    }
    output.set(root, paints);
  }
  return output;
}
