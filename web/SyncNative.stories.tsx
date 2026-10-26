import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { getDocsEmptySnapshot, ICommandService, LocaleType, type Univer } from '@univerjs/core';
import { IRenderManagerService, TRANSFORM_CHANGE_OBSERVABLE_TYPE } from '@univerjs/engine-render';
import { DocCanvasPopManagerService } from '@univerjs/docs-ui';
import { ILocalFileService } from '@univerjs/ui';
import { createUniver, mergeLocales } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import {
  collectDocDrawings,
  getDrawingShapeKeyByDrawingSearch,
  IDrawingManagerService,
  InsertDocImageCommand,
  UniverDocsDrawingPreset,
} from '@univerjs/preset-docs-drawing';
import { createNativeSyncClient, type SyncClient } from '@spinel/sync-client';
import docsEnglish from '@univerjs/preset-docs-core/locales/en-US';
import drawingEnglish from '@univerjs/preset-docs-drawing/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import '@univerjs/preset-docs-drawing/lib/index.css';
import { editorTheme, installCanvasColors, bindEditorTheme } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { editorReady } from './editorReady.ts';
import { documentReady } from './documentReady.ts';
import '../src/ui/redesign/nativeEditors.css';

/** A local file chooser fixture; image decoding and insertion use the real native UI. */
async function imageFile() {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 80;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#3f6cc9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.font = '16px sans-serif';
  context.fillText('Weekend plans', 16, 46);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Could not create the local image fixture.'));
    }, 'image/png'),
  );
  return new File([blob], 'weekend.png', { type: 'image/png' });
}

function NativeDrawingCapture() {
  const host = useRef<HTMLDivElement>(null);
  const action = useRef({ insert: async () => {}, resize: () => {}, restore: () => {} });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [observation, setObservation] = useState('');
  useEffect(() => {
    let univer: Univer | undefined;
    let client: SyncClient | undefined;
    let disposed = false;
    const abort = new AbortController();
    const cleanups: (() => void)[] = [];
    const release = () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      cleanups.reverse().forEach((close) => close());
      client?.dispose();
      queueMicrotask(() => univer?.dispose());
    };
    void (async () => {
      await Promise.resolve();
      if (disposed) return;
      const created = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(docsEnglish, drawingEnglish) },
        presets: [
          UniverDocsCorePreset({ container: host.current!, disableAutoFocus: true }),
          UniverDocsDrawingPreset({ collaboration: false }),
        ],
      });
      univer = created.univer;
      installCanvasColors(univer);
      const file = await imageFile();
      if (disposed) return;
      const injector = univer.__getInjector();
      injector.replace([
        ILocalFileService,
        {
          useValue: {
            openFile: async () => [file],
            downloadFile: () => {},
          },
        },
      ]);
      const unitId = 'native-doc-drawing-capture';
      const snapshot = getDocsEmptySnapshot(unitId, LocaleType.EN_US, 'Image capture fixture');
      snapshot.drawings = {};
      snapshot.drawingsOrder = [];
      const text = 'A place for the weekend photo.\r\n';
      snapshot.body = {
        ...snapshot.body,
        dataStream: text,
        paragraphs: [{ startIndex: text.length - 2, paragraphId: 'drawing-capture-paragraph' }],
        sectionBreaks: [{ startIndex: text.length - 1, sectionId: 'drawing-capture-section' }],
      };
      const document = created.univerAPI.createDocument(snapshot);
      await editorReady(created.univerAPI);
      if (disposed) return;
      await documentReady(univer, unitId, abort.signal);
      if (disposed) return;
      const render = injector.get(IRenderManagerService).getRenderUnitById(unitId)!;
      render.engine.getCanvasElement().setAttribute('aria-label', 'Document canvas');
      cleanups.push(bindEditorTheme(univer));
      document.setSelection(0, 0);
      const commands = injector.get(ICommandService);
      const drawingManager = injector.get(IDrawingManagerService);
      const geometry = injector.get(DocCanvasPopManagerService);
      const raw: string[] = [];
      const failures: string[] = [];
      let resized = 0;
      let controlsCreated = 0;
      const observe = () => {
        if (disposed || !client) return;
        const checkpoint = client.checkpoint();
        const snapshot = document.save();
        const drawings = collectDocDrawings(snapshot).drawings;
        const ids = Object.keys(drawings);
        const image = ids.length
          ? render.scene.getObject(
              getDrawingShapeKeyByDrawingSearch({ unitId, subUnitId: unitId, drawingId: ids[0] }),
            )
          : undefined;
        // An inline image is a structural control character, so text-range bounds skip it.
        // Read the actual scene object and project its bounds into client coordinates instead.
        const imageRect = image?.visible ? image.getRealBound() : undefined;
        const viewport = render.scene.getViewport('viewMain');
        const canvasRect = render.engine.getCanvasElement().getBoundingClientRect();
        const scale = render.scene.getAncestorScale();
        const scaleX = (scale.scaleX * canvasRect.width) / render.engine.width;
        const scaleY = (scale.scaleY * canvasRect.height) / render.engine.height;
        const imageBounds =
          imageRect && viewport && render.engine.width > 0 && render.engine.height > 0
            ? {
                left: canvasRect.left + (imageRect.left - viewport.viewportScrollX) * scaleX,
                right:
                  canvasRect.left +
                  (imageRect.left + imageRect.width - viewport.viewportScrollX) * scaleX,
                top: canvasRect.top + (imageRect.top - viewport.viewportScrollY) * scaleY,
                bottom:
                  canvasRect.top +
                  (imageRect.top + imageRect.height - viewport.viewportScrollY) * scaleY,
              }
            : undefined;
        const textOffset = snapshot.body?.dataStream.indexOf('place') ?? -1;
        setObservation(
          JSON.stringify({
            raw,
            failures,
            resized,
            controlsCreated,
            pending: client.state.pendingMutations,
            pendingIds: [...checkpoint.inflight, ...checkpoint.buffer.flat()].map(
              (mutation) => mutation.id,
            ),
            drawings: ids.length,
            rendered: ids.filter(
              (drawingId) =>
                render.scene.getObject(
                  getDrawingShapeKeyByDrawingSearch({ unitId, subUnitId: unitId, drawingId }),
                )?.visible,
            ).length,
            focused: drawingManager.getFocusDrawings().length,
            controls: render.scene.getTransformer()?.getSelectedObjectMap().size ?? 0,
            imageBounds,
            textBounds:
              ids.length && textOffset >= 0
                ? geometry.getRangeBounds(
                    {
                      startOffset: textOffset,
                      endOffset: textOffset + 1,
                      collapsed: false,
                      segmentId: '',
                      segmentPage: -1,
                    },
                    unitId,
                  )?.[0]
                : undefined,
          }),
        );
      };
      const stream = commands.onMutationExecutedForCollab((info) => {
        raw.push(info.id);
        observe();
      });
      cleanups.push(() => stream.dispose());
      const resize = render.engine.onTransformChange$.subscribeEvent((event) => {
        if (event.type === TRANSFORM_CHANGE_OBSERVABLE_TYPE.resize) resized++;
      });
      const controls = render.scene.getTransformerByCreate().createControl$.subscribe(() => {
        controlsCreated++;
      });
      cleanups.push(
        () => resize.unsubscribe(),
        () => controls.unsubscribe(),
      );
      client = createNativeSyncClient({
        univer,
        unitId,
        kind: 'doc',
        snapshot: document.save(),
        revision: 1,
        send: () => {},
        onState: observe,
        onResync: (reason) => {
          failures.push(reason);
          observe();
        },
      });
      // The fixture deliberately keeps the queue unacknowledged to inspect actual pending edits.
      action.current = {
        insert: async () => {
          if (!(await commands.executeCommand(InsertDocImageCommand.id)))
            throw new Error('Native image insertion did not complete.');
          observe();
        },
        // A real host resize exercises DocDrawingTransformUpdateController's native refresh.
        resize: () => {
          host.current!.style.width = 'calc(100% - 8px)';
        },
        restore: () => {
          host.current!.style.width = '100%';
        },
      };
      const timer = window.setInterval(observe, 100);
      cleanups.push(() => clearInterval(timer));
      observe();
      setReady(true);
    })().catch((cause: unknown) => {
      if (!disposed) {
        setError(String(cause));
        release();
      }
    });
    return release;
  }, []);
  const run = (callback: () => void | Promise<void>) => {
    void Promise.resolve()
      .then(callback)
      .catch((cause: unknown) => setError(String(cause)));
  };
  return (
    <div className="sp-ui rd-native-story">
      <details className="rd-native-review-tools">
        <summary>Doc drawing capture controls</summary>
        <p>
          Native image insertion and selection with a local pending queue. Click the image or the
          text beside it to change selection. No server connection or save acknowledgment is
          simulated.
        </p>
        <button className="sp-control" disabled={!ready} onClick={() => run(action.current.insert)}>
          Insert fixture image
        </button>
        <button
          className="sp-control"
          disabled={!ready}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => run(action.current.resize)}
        >
          Narrow editor
        </button>
        <button
          className="sp-control"
          disabled={!ready}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => run(action.current.restore)}
        >
          Restore editor width
        </button>
      </details>
      <output hidden data-native-drawing-capture>
        {observation}
      </output>
      {error && <p role="alert">{error}</p>}
      <section
        className="rd-native-editor"
        aria-label="Document editor"
        data-native-ready={ready}
        aria-busy={!ready && !error}
      >
        <div className="rd-native-host" ref={host} />
      </section>
    </div>
  );
}

const meta = {
  id: 'editor-sync-native',
  title: 'Current production/Editor/Native sync capture',
  component: NativeDrawingCapture,
  parameters: { shell: 'none', layout: 'fullscreen' },
} satisfies Meta<typeof NativeDrawingCapture>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DocDrawingCapture: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const read = () =>
      JSON.parse(canvasElement.querySelector('[data-native-drawing-capture]')!.textContent!);
    await waitFor(
      () =>
        expect(canvas.getByRole('region', { name: 'Document editor' })).toHaveAttribute(
          'data-native-ready',
          'true',
        ),
      { timeout: 35_000 },
    );
    await userEvent.click(canvas.getByText('Doc drawing capture controls'));
    await userEvent.click(canvas.getByRole('button', { name: 'Insert fixture image' }));
    await waitFor(
      () => {
        expect(read().drawings).toBe(1);
        expect(read().rendered).toBe(1);
        expect(read().pending).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );
    expect(read().raw).toContain('doc.mutation.rich-text-editing');
    expect(read().pendingIds).toContain('doc.mutation.rich-text-editing');
    const pending = read().pending;
    const nativeCanvas = canvasElement.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Document canvas"]',
    )!;
    const clickRange = async (key: 'imageBounds' | 'textBounds') => {
      // Rendering the object and publishing text layout are asynchronous. Re-read the
      // geometry after each layout change, and click only the visible part of the target.
      const coords = await waitFor(
        () => {
          const bounds = read()[key];
          if (!bounds) throw new Error(`Native ${key} are not available yet.`);
          expect(
            [bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite),
          ).toBe(true);
          const visible = nativeCanvas.getBoundingClientRect();
          const left = Math.max(bounds.left, visible.left + 1);
          const right = Math.min(bounds.right, visible.right - 1);
          const top = Math.max(bounds.top, visible.top + 1);
          const bottom = Math.min(bounds.bottom, visible.bottom - 1);
          expect(right).toBeGreaterThan(left);
          expect(bottom).toBeGreaterThan(top);
          const clientX = (left + right) / 2;
          const clientY = (top + bottom) / 2;
          // userEvent defaults omitted offsets to zero; Univer's mouse hit testing
          // reads offsets in the canvas's unscaled CSS pixel coordinate system.
          return {
            clientX,
            clientY,
            offsetX: ((clientX - visible.left) * nativeCanvas.clientWidth) / visible.width,
            offsetY: ((clientY - visible.top) * nativeCanvas.clientHeight) / visible.height,
            pageX: clientX + window.scrollX,
            pageY: clientY + window.scrollY,
          };
        },
        { timeout: 10_000 },
      );
      await userEvent.pointer({
        target: nativeCanvas,
        keys: '[MouseLeft]',
        coords,
      });
    };
    await clickRange('textBounds');
    await waitFor(() => expect(read().focused).toBe(0));
    await clickRange('imageBounds');
    await waitFor(() => expect(read()).toMatchObject({ focused: 1, controls: 1 }));
    const resized = read().resized,
      controlsCreated = read().controlsCreated;
    await userEvent.click(canvas.getByRole('button', { name: 'Narrow editor' }));
    await waitFor(() => {
      expect(read().resized).toBeGreaterThan(resized);
      expect(read().controlsCreated).toBeGreaterThan(controlsCreated);
    });
    expect(read().pending).toBe(pending);
    const narrowed = read().resized;
    await userEvent.click(canvas.getByRole('button', { name: 'Restore editor width' }));
    await waitFor(() => expect(read().resized).toBeGreaterThan(narrowed));
    await clickRange('textBounds');
    await waitFor(() => expect(read().focused).toBe(0));
    expect(read().pending).toBe(pending);
    expect(read().pendingIds).not.toContain('doc.operation.clear-drawing-transformer');
    expect(read().failures).toEqual([]);
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByText('Doc drawing capture controls'));
  },
};
