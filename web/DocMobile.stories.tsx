import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import {
  createParagraphId,
  createSectionId,
  DocumentFlavor,
  getDocsEmptySnapshot,
  LocaleType,
} from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import { DocSkeletonManagerService } from '@univerjs/docs';
import { calcDocRangePositions, DocSelectionRenderService } from '@univerjs/docs-ui';
import { IRenderManagerService, ptToPixel } from '@univerjs/engine-render';
import { createUniver, mergeLocales } from '@univerjs/presets';
import { ContextMenuPosition, IContextMenuService } from '@univerjs/ui';
import { UniverDocsDrawingPreset } from '@univerjs/preset-docs-drawing';
import { UniverDocsHyperLinkPreset } from '@univerjs/preset-docs-hyper-link';
import docsEnglish from '@univerjs/preset-docs-core/locales/en-US';
import drawingEnglish from '@univerjs/preset-docs-drawing/locales/en-US';
import linkEnglish from '@univerjs/preset-docs-hyper-link/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import '@univerjs/preset-docs-drawing/lib/index.css';
import '@univerjs/preset-docs-hyper-link/lib/index.css';
import { editorTheme, bindEditorTheme, installCanvasColors } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { docPreset, mobileDocPlugins } from './docPreset.ts';
import { nativeSyncPermissions } from './nativeSyncPermissions.ts';
import { documentReady } from './documentReady.ts';
import { editorReady } from './editorReady.ts';
import { EditorFrame, useEditorChrome } from './EditorFrame.tsx';
import { EditorTools } from './EditorTools.tsx';
import { SaveStatus } from './SaveStatus.tsx';

interface MobileDocProps {
  viewer?: boolean;
  traditional?: boolean;
  layoutChanged?: boolean;
  zoomRatio?: number;
}

interface Observation {
  hostWidth: number;
  canvasWidth: number;
  pageWidths: number[];
  lines: number;
  minimumFontPixels: number;
  scale: number;
  userZoom: number;
  unchanged: boolean;
  canEdit: boolean;
}

// Story-local commands/observations only. No test API or editor reference is
// exposed by the application. The bounds come from the native selected range,
// never from its deliberately off-caret, fixed-position contenteditable input.
const mobileDocFixtures = new WeakMap<
  HTMLElement,
  {
    observe(): Observation;
    append(): { applied: boolean; end: number; text: string };
    focus(): boolean;
    selectWord(): void;
    openSelectionMenu(anchor: { left: number; bottom: number }): void;
    caret(): {
      start: number | undefined;
      end: number | undefined;
      hasAnchor: boolean;
      editing: boolean;
      bounds: { left: number; right: number; top: number; bottom: number } | undefined;
      scroll: number;
      text: string;
      italicText: string[];
      layoutUnchanged: boolean;
    };
  }
>();

const paragraphs = [
  'Autumn notes',
  'A weekend away, a few good meals, and room for a change of plans. Leave after breakfast, take the coast road, and stop somewhere for lunch before the light begins to fade.',
  'Make time for a long walk, the little bookshop near the harbor, and a warm bowl of soup. Bring a notebook for the things we want to remember.',
  'Before we leave',
  'Check the forecast. Water the plants. Download the reservations so they are with us even without a connection. Leave a little room in the day for something unexpected.',
];

/** Local fixture using the production preset; live persistence is tested in Playwright. */
function MobileCanvas({
  viewer = false,
  traditional = false,
  layoutChanged = false,
  zoomRatio = 1,
}: MobileDocProps) {
  const chrome = useEditorChrome();
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const readOnly = viewer || traditional || layoutChanged;
  const savedMessage = layoutChanged
    ? 'View only on this phone. Reopen after the page layout change.'
    : readOnly
      ? 'View only.'
      : 'All changes saved.';
  useEffect(() => {
    const abort = new AbortController();
    const cleanups: (() => void)[] = [];
    let univer: Univer | undefined;
    setReady(false);
    setError('');
    void (async () => {
      await Promise.resolve();
      if (abort.signal.aborted) return;
      const id = 'mobile-doc-review';
      const data = getDocsEmptySnapshot(
        id,
        LocaleType.EN_US,
        'Autumn notes',
        traditional ? DocumentFlavor.TRADITIONAL : DocumentFlavor.MODERN,
      );
      data.settings = { ...data.settings, zoomRatio };
      data.drawings = {};
      data.drawingsOrder = [];
      const stream = paragraphs.join('\r') + '\r\n';
      let offset = 0;
      const paragraphIds = new Set<string>();
      data.body = {
        ...data.body,
        dataStream: stream,
        paragraphs: paragraphs.map((text) => {
          offset += text.length + 1;
          return {
            startIndex: offset - 1,
            paragraphId: createParagraphId(paragraphIds),
            paragraphStyle: { spaceAbove: { v: 4 }, spaceBelow: { v: 12 } },
          };
        }),
        textRuns: [
          { st: 0, ed: paragraphs[0].length, ts: { fs: 22, bl: 1 } },
          { st: paragraphs[0].length, ed: stream.length - 2, ts: { fs: 12 } },
        ],
        sectionBreaks: [{ startIndex: stream.length - 1, sectionId: createSectionId(new Set()) }],
      };
      const stored = JSON.stringify([data.body, data.documentStyle, data.settings]);
      const created = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(docsEnglish, drawingEnglish, linkEnglish) },
        override: nativeSyncPermissions(id, readOnly ? 'viewer' : 'owner').override,
        presets: [
          docPreset(host.current!, true, readOnly),
          mobileDocPlugins(UniverDocsDrawingPreset(), true),
          mobileDocPlugins(UniverDocsHyperLinkPreset(), true),
        ],
      });
      univer = created.univer;
      installCanvasColors(univer);
      const doc = created.univerAPI.createDocument(data);
      await editorReady(created.univerAPI);
      if (abort.signal.aborted) return;
      await documentReady(univer, id, abort.signal);
      if (abort.signal.aborted) return;
      cleanups.push(bindEditorTheme(univer));
      const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(id)!;
      const canvas = render.engine.getCanvasElement();
      canvas.setAttribute('aria-label', 'Document canvas');
      const skeletons = render.with(DocSkeletonManagerService);
      const selections = render.with(DocSelectionRenderService);
      const contextMenus = univer.__getInjector().get(IContextMenuService);
      const layout = JSON.stringify([data.documentStyle, data.settings]);
      const fixtureHost = host.current!;
      mobileDocFixtures.set(fixtureHost, {
        observe() {
          // Native resizing waits for an idle callback, and incremental layout
          // publishes on the skeleton itself without replacing currentSkeleton$.
          // Read each assertion's current geometry instead of caching one RAF.
          const pages = skeletons.getSkeleton().getSkeletonData()?.pages ?? [];
          const lines = pages.flatMap((page) =>
            page.sections.flatMap((section) => section.columns.flatMap((column) => column.lines)),
          );
          const fonts = lines.flatMap((line) =>
            line.divides.flatMap((divide) =>
              divide.glyphGroup.flatMap((glyph) =>
                glyph.content.trim() && glyph.fontStyle
                  ? [ptToPixel(glyph.fontStyle.originFontSize) * render.scene.scaleX]
                  : [],
              ),
            ),
          );
          const snapshot = doc.getDocumentDataModel().getSnapshot();
          return {
            hostWidth: fixtureHost.getBoundingClientRect().width,
            canvasWidth: canvas.getBoundingClientRect().width,
            pageWidths: pages.map((page) => page.pageWidth),
            lines: lines.length,
            minimumFontPixels: Math.min(...fonts),
            scale: render.scene.scaleX,
            userZoom: snapshot.settings?.zoomRatio ?? 1,
            unchanged:
              JSON.stringify([snapshot.body, snapshot.documentStyle, snapshot.settings]) === stored,
            canEdit: doc.getPermission().canEdit(),
          };
        },
        append() {
          const before = doc.getDocumentDataModel().getSnapshot().body!.dataStream;
          const text = ' Keep the final sentence visible while writing on a phone.'.repeat(24);
          const index = before.length - 2;
          const applied = doc.insertText(index, text);
          const end = index + text.length;
          doc.setSelection(end, end);
          return { applied, end, text: before.slice(0, index) + text + before.slice(index) };
        },
        focus: () => selections.enterEditing(),
        selectWord: () => doc.setSelection(0, 'Autumn'.length),
        openSelectionMenu(anchor) {
          selections.exitEditing();
          contextMenus.triggerContextMenu(
            new MouseEvent('contextmenu', { clientX: anchor.left, clientY: anchor.bottom }),
            ContextMenuPosition.MAIN_AREA,
            { unitId: id, subUnitId: id },
          );
        },
        caret() {
          const range = selections.getActiveTextRange();
          const start = range?.startOffset;
          const end = range?.endOffset;
          const snapshot = doc.getDocumentDataModel().getSnapshot();
          return {
            start,
            end,
            hasAnchor: Boolean(range?.getAnchor()),
            editing: selections.isEditing,
            bounds:
              start !== undefined && end !== undefined
                ? calcDocRangePositions(
                    {
                      startOffset: start,
                      endOffset: end,
                      collapsed: start === end,
                      segmentId: range!.segmentId,
                      segmentPage: range!.segmentPage,
                    },
                    render,
                  )?.[0]
                : undefined,
            scroll: render.scene.getViewport('viewMain')?.viewportScrollY ?? 0,
            text: snapshot.body!.dataStream,
            italicText: (snapshot.body!.textRuns ?? [])
              .filter((run) => run.ts?.it === 1)
              .map((run) => snapshot.body!.dataStream.slice(run.st, run.ed)),
            layoutUnchanged: JSON.stringify([snapshot.documentStyle, snapshot.settings]) === layout,
          };
        },
      });
      cleanups.push(() => mobileDocFixtures.delete(fixtureHost));
      setReady(true);
    })().catch((cause) => {
      if (!abort.signal.aborted) setError(String(cause));
    });
    return () => {
      abort.abort();
      cleanups.reverse().forEach((close) => close());
      queueMicrotask(() => univer?.dispose());
    };
  }, [readOnly, traditional, zoomRatio]);
  return (
    <section
      className="sheet-editor"
      aria-label="Mobile Doc review"
      aria-busy={!ready && !error}
      data-mobile="true"
      data-mobile-doc-ready={ready}
    >
      <SaveStatus
        target={chrome?.saveTarget ?? null}
        state={{
          dirty: false,
          failed: Boolean(error),
          message: error || (ready ? savedMessage : 'Loading document…'),
        }}
        onRetry={() => {}}
      />
      <EditorTools id="mobile-doc-review" name="Autumn notes" people={[]} saved={ready} />
      <p className="editor-help" role={error ? 'alert' : undefined}>
        {error ||
          (layoutChanged
            ? 'This Doc’s page layout changed. Reopen it to continue.'
            : traditional
              ? 'Edit on a larger screen. This Doc keeps its page layout.'
              : viewer
                ? ''
                : 'Tap Edit, then tap the text to write.')}
      </p>
      <div className="univer-container" ref={host} />
    </section>
  );
}

function MobileDocStory(props: MobileDocProps) {
  return (
    <div className="workspace" data-mobile-doc-shell style={{ width: '100%', minWidth: 0 }}>
      <EditorFrame
        name="Autumn notes"
        connection="online"
        access={props.viewer ? 'View only' : 'Can edit'}
        documentKey="mobile-doc-review"
      >
        <MobileCanvas {...props} />
      </EditorFrame>
    </div>
  );
}

const meta = {
  id: 'docs-mobile',
  title: 'Current production/Docs/Mobile',
  component: MobileDocStory,
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Native mobile plugins with local fixture data and the production editor frame. Save/connection labels are fixture states. These browser checks do not establish physical iPhone/Android keyboard, IME, or touch behavior.',
      },
    },
  },
} satisfies Meta<typeof MobileDocStory>;
export default meta;
type Story = StoryObj<typeof meta>;

const observe = (canvas: HTMLElement): Observation =>
  mobileDocFixtures.get(canvas.querySelector<HTMLElement>('.univer-container')!)!.observe();

async function ready(
  canvasElement: HTMLElement,
  editable: boolean,
  modern: boolean,
  zoomRatio = 1,
) {
  await waitFor(
    () => {
      expect(within(canvasElement).queryByRole('alert')).not.toBeInTheDocument();
      expect(
        within(canvasElement).getByRole('region', { name: 'Mobile Doc review' }),
      ).toHaveAttribute('data-mobile-doc-ready', 'true');
      const evidence = observe(canvasElement);
      expect(evidence).not.toBeNull();
      expect(evidence.unchanged).toBe(true);
      expect(evidence.canEdit).toBe(editable);
      expect(evidence.userZoom).toBe(zoomRatio);
      expect(evidence.canvasWidth).toBeLessThanOrEqual(evidence.hostWidth + 1);
      expect(evidence.lines).toBeGreaterThanOrEqual(paragraphs.length);
      if (editable) {
        const edit = within(canvasElement).getByRole('button', { name: 'Edit' });
        expect(edit.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
        expect(edit.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
      if (modern) {
        expect(evidence.scale).toBe(1);
        expect(evidence.minimumFontPixels).toBeGreaterThanOrEqual(15.9);
        expect(Math.max(...evidence.pageWidths)).toBeLessThanOrEqual(evidence.hostWidth);
      }
    },
    { timeout: 35_000 },
  );
}

async function reflows(canvasElement: HTMLElement, editable: boolean, zoomRatio = 1) {
  await ready(canvasElement, editable, true, zoomRatio);
  const initial = observe(canvasElement);
  const shell = canvasElement.querySelector<HTMLElement>('[data-mobile-doc-shell]')!;
  const canvas = within(canvasElement).getByLabelText('Document canvas');
  try {
    shell.style.maxWidth = '320px';
    await waitFor(() => {
      const narrow = observe(canvasElement);
      expect(narrow.hostWidth).toBeLessThan(initial.hostWidth);
      expect(Math.max(...narrow.pageWidths)).toBeLessThanOrEqual(narrow.hostWidth);
      expect(narrow.lines).toBeGreaterThan(initial.lines);
      expect(narrow.scale).toBe(1);
      expect(narrow.unchanged).toBe(true);
      expect(narrow.minimumFontPixels).toBeGreaterThanOrEqual(15.9);
      expect(canvas.isConnected).toBe(true);
    });
  } finally {
    shell.style.removeProperty('max-width');
  }
  await waitFor(() => {
    const restored = observe(canvasElement);
    expect(restored.hostWidth).toBe(initial.hostWidth);
    expect(restored.lines).toBe(initial.lines);
    expect(restored.unchanged).toBe(true);
  });
}

export const Reading: Story = { play: ({ canvasElement }) => reflows(canvasElement, true) };
export const SavedHalfZoom: Story = {
  args: { zoomRatio: 0.5 },
  play: ({ canvasElement }) => reflows(canvasElement, true, 0.5),
};
export const SavedDoubleZoom: Story = {
  args: { zoomRatio: 2 },
  play: ({ canvasElement }) => reflows(canvasElement, true, 2),
};
export const Viewer: Story = {
  args: { viewer: true, zoomRatio: 2 },
  play: async ({ canvasElement }) => {
    await reflows(canvasElement, false, 2);
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  },
};
export const Traditional: Story = {
  args: { traditional: true },
  play: async ({ canvasElement }) => {
    await ready(canvasElement, false, false);
    await expect(
      within(canvasElement).getByText('Edit on a larger screen. This Doc keeps its page layout.'),
    ).toBeVisible();
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  },
};

export const LayoutChanged: Story = {
  args: { layoutChanged: true },
  parameters: {
    docs: {
      description: {
        story:
          'Fixture for the rendered local read-only state, using a modern native canvas, the viewer permission fence, and reopen guidance. The account keeps its grant. Peer changes and pending saves are verified separately in E2E.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement, false, true);
    const screen = within(canvasElement);
    await expect(
      screen.getByText('This Doc’s page layout changed. Reopen it to continue.', { exact: true }),
    ).toBeVisible();
    await expect(screen.getByRole('status', { name: 'Save status' }).textContent).toBe(
      'View only on this phone. Reopen after the page layout change.',
    );
    await expect(screen.getByRole('button', { name: 'Save details: View only' })).toHaveAttribute(
      'data-failed',
      'false',
    );
    for (const name of ['Edit', 'Format', 'Heading', 'Insert formula'])
      await expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Document actions' }));
    const body = within(canvasElement.ownerDocument.body);
    const menu = await body.findByRole('menu');
    await expect(
      within(menu).queryByRole('menuitem', { name: 'Insert formula' }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument());
    expect(observe(canvasElement).unchanged).toBe(true);
  },
};

export const SelectionFormatting: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Sets the Autumn word range through the public Doc API as fixture setup, opens the native selected-text drawer, and clicks its actual Italic control. Verifies the exact styled substring and unchanged text, saved page layout, and zoom. Touch selection itself is covered separately by E2E; this is not physical long-press evidence.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement, true, true);
    const host = canvasElement.querySelector<HTMLElement>('.univer-container')!;
    const fixture = mobileDocFixtures.get(host)!;
    const originalText = fixture.caret().text;
    expect(fixture.caret().italicText).toEqual([]);
    await userEvent.click(within(host).getByRole('button', { name: 'Edit' }));

    const openSelection = async () => {
      // Only the range is fixture-driven; the drawer and action are native UI.
      fixture.selectWord();
      await waitFor(
        () => {
          const selection = fixture.caret();
          expect(selection.start).toBe(0);
          expect(selection.end).toBe('Autumn'.length);
          expect(selection.hasAnchor).toBe(true);
          expect(selection.bounds).toBeDefined();
        },
        { timeout: 10_000 },
      );
      fixture.openSelectionMenu(fixture.caret().bounds!);
      await waitFor(
        () => expect(host.querySelector('[data-u-comp="mobile-menu-drawer"]')).toBeVisible(),
        { timeout: 10_000 },
      );
      const drawer = host.querySelector<HTMLElement>('[data-u-comp="mobile-menu-drawer"]')!;
      await userEvent.click(within(drawer).getByRole('button', { name: 'More' }));
      await waitFor(
        () => {
          expect(drawer).toHaveAttribute('data-snap', 'expanded');
          expect(fixture.caret().editing).toBe(false);
          for (const name of ['Bold', 'Italic']) {
            const button = within(drawer).getByRole('button', { name });
            expect(button).toBeVisible();
            expect(button).toBeEnabled();
            const bounds = button.getBoundingClientRect();
            expect(bounds.top).toBeGreaterThanOrEqual(drawer.getBoundingClientRect().top);
            expect(bounds.bottom).toBeLessThanOrEqual(drawer.getBoundingClientRect().bottom);
            expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
          }
          for (const button of within(drawer).getAllByRole('button')) {
            expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
            expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
          }
        },
        { timeout: 10_000 },
      );
      return drawer;
    };

    const drawer = await openSelection();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Italic' }));
    await waitFor(
      () => {
        expect(drawer).not.toBeInTheDocument();
        const formatted = fixture.caret();
        expect(formatted.italicText).toEqual(['Autumn']);
        expect(formatted.text).toBe(originalText);
        expect(formatted.layoutUnchanged).toBe(true);
      },
      { timeout: 10_000 },
    );
    // Leave the actual selected-text controls open for light/dark phone capture.
    await openSelection();
    expect(fixture.caret().italicText).toEqual(['Autumn']);
    expect(fixture.caret().text).toBe(originalText);
    expect(fixture.caret().layoutUnchanged).toBe(true);
  },
};

export const KeyboardViewportResponse: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Emulates a VisualViewport height reduction, enters the actual native Edit mode, appends text through the public Doc API, and checks the selected caret above the native keyboard toolbar. This verifies browser layout response, not an operating-system keyboard, physical touch, or IME.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await ready(canvasElement, true, true);
    const host = canvasElement.querySelector<HTMLElement>('.univer-container')!;
    const fixture = mobileDocFixtures.get(host)!;
    const viewport = window.visualViewport;
    expect(viewport).not.toBeNull();
    const originalHeight = Object.getOwnPropertyDescriptor(viewport!, 'height');
    const fullHeight = viewport!.height;
    const canvas = within(host).getByLabelText('Document canvas');
    await userEvent.click(within(host).getByRole('button', { name: 'Edit' }));
    const insertion = fixture.append();
    expect(insertion.applied).toBe(true);
    await waitFor(
      () => {
        const caret = fixture.caret();
        expect(caret.start).toBe(insertion.end);
        expect(caret.end).toBe(insertion.end);
        expect(caret.hasAnchor).toBe(true);
        expect(caret.bounds).toBeDefined();
        expect(caret.text).toBe(insertion.text);
      },
      { timeout: 10_000 },
    );
    expect(fixture.focus()).toBe(true);
    const visibleHeight = Math.min(fullHeight - 240, canvas.getBoundingClientRect().top + 240);
    try {
      Object.defineProperty(viewport, 'height', { configurable: true, value: visibleHeight });
      viewport!.dispatchEvent(new Event('resize'));
      await waitFor(
        () => {
          const hideKeyboard = within(host).getByRole('button', { name: 'Hide keyboard' });
          expect(hideKeyboard).toBeVisible();
          const toolbar = hideKeyboard.parentElement!.getBoundingClientRect();
          for (const button of within(hideKeyboard.parentElement!).getAllByRole('button')) {
            expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
            expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
          }
          const canvasBounds = canvas.getBoundingClientRect();
          const caret = fixture.caret();
          expect(caret.editing).toBe(true);
          expect(caret.hasAnchor).toBe(true);
          expect(caret.start).toBe(insertion.end);
          expect(caret.end).toBe(insertion.end);
          expect(caret.bounds).toBeDefined();
          expect(caret.bounds!.top).toBeGreaterThanOrEqual(canvasBounds.top - 1);
          expect(caret.bounds!.bottom).toBeLessThanOrEqual(toolbar.top + 1);
          expect(caret.bounds!.left).toBeGreaterThanOrEqual(canvasBounds.left - 1);
          expect(caret.bounds!.right).toBeLessThanOrEqual(canvasBounds.right + 1);
          expect(caret.bounds!.bottom).toBeGreaterThan(caret.bounds!.top);
          expect(toolbar.bottom).toBeLessThanOrEqual(viewport!.offsetTop + visibleHeight + 1);
          expect(caret.scroll).toBeGreaterThan(0);
          expect(caret.layoutUnchanged).toBe(true);
          expect(caret.text).toBe(insertion.text);
        },
        { timeout: 10_000 },
      );
    } finally {
      if (originalHeight) Object.defineProperty(viewport, 'height', originalHeight);
      else Reflect.deleteProperty(viewport!, 'height');
      viewport!.dispatchEvent(new Event('resize'));
      const done = within(host).queryByRole('button', { name: 'Done' });
      if (done) await userEvent.click(done);
    }
    await waitFor(() =>
      expect(within(host).queryByRole('button', { name: 'Hide keyboard' })).not.toBeInTheDocument(),
    );
  },
};
