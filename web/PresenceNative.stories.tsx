import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { getDocsEmptySnapshot, LocaleType, type Univer } from '@univerjs/core';
import { DocSelectionManagerService } from '@univerjs/docs';
import { calcDocRangePositions, DocSelectionRenderService } from '@univerjs/docs-ui';
import { IRenderManagerService, Rect, RegularPolygon } from '@univerjs/engine-render';
import { setLocalDocSelectionColor } from '@spinel/presence-ui';
import { createUniver } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import docsEnglish from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import { editorTheme, installCanvasColors, bindEditorTheme } from '../src/ui/editorTheme.ts';
import { getTheme } from '../src/ui/theme.ts';
import { profileAvatar } from '../src/profile/profile.ts';
import { Collaborators, watchPresence, type Collaborator } from './Collaborators.tsx';
import { EditorFrame, useEditorChrome } from './EditorFrame.tsx';
import { SaveStatus } from './SaveStatus.tsx';
import { editorReady } from './editorReady.ts';
import { documentReady } from './documentReady.ts';
import { presenceRenderColors } from './presenceColors.ts';
import { setSyncPresence, type SyncPresenceState } from './syncPresence.ts';
import '../src/ui/redesign/nativeEditors.css';

interface PresenceStoryProps {
  selection?: boolean;
  guest?: boolean;
  disconnected?: boolean;
}

function localSelectionObservation(
  native: DocSelectionRenderService,
  logical: ReturnType<DocSelectionManagerService['getSelectionInfo']>,
  snapshot: unknown,
) {
  const range = native.getActiveTextRange();
  const anchor = range?.getAnchor();
  const box = native.selectionContainer.getBoundingClientRect();
  return {
    focused: native.hasFocus(),
    pointer: native.isOnPointerEvent,
    pending: native.hasPendingSelection,
    host: { x: box.x, y: box.y },
    native: range ? { start: range.startOffset, end: range.endOffset } : null,
    anchor: anchor
      ? { visible: anchor.visible, left: anchor.left, top: anchor.top, height: anchor.height }
      : null,
    logical: logical?.textRanges.map((value) => ({
      start: value.startOffset,
      end: value.endOffset,
      direction: value.direction,
      collapsed: value.collapsed,
      segmentId: value.segmentId,
      segmentPage: value.segmentPage,
    })),
    style: {
      stroke: logical?.textRanges[0]?.style?.strokeActive,
      fill: logical?.textRanges[0]?.style?.fill,
    },
    snapshot: JSON.stringify(snapshot),
  };
}

// Story-local access to the real adapter and read-only native geometry. The
// application exposes no selection setter or test mutation hook.
const localColorFixtures = new WeakMap<
  HTMLElement,
  {
    input: HTMLDivElement;
    textBounds(): ReturnType<typeof calcDocRangePositions>;
    restyle(color: string): {
      before: ReturnType<typeof localSelectionObservation>;
      after: ReturnType<typeof localSelectionObservation>;
    };
  }
>();

/** Uses the production adapter and actual OSS canvas/popup APIs with local room frames. */
function NativePresenceCanvas({
  selection = false,
  guest = false,
  disconnected = false,
  onConnectedChange,
}: PresenceStoryProps & { onConnectedChange(connected: boolean): void }) {
  const chrome = useEditorChrome();
  const host = useRef<HTMLDivElement>(null);
  const change = useRef<(connected: boolean, selection: string) => void>(() => {});
  const [people, setPeople] = useState<Collaborator[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [observation, setObservation] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    const cleanups: (() => void)[] = [];
    let univer: Univer | undefined;
    let disposed = false;
    const release = () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      cleanups.reverse().forEach((close) => close());
      queueMicrotask(() => univer?.dispose());
    };
    void (async () => {
      await Promise.resolve();
      if (disposed) return;
      const created = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: docsEnglish },
        presets: [UniverDocsCorePreset({ container: host.current!, disableAutoFocus: true })],
      });
      univer = created.univer;
      installCanvasColors(univer);
      const id = 'native-presence-doc';
      const data = getDocsEmptySnapshot(id, LocaleType.EN_US, 'Autumn plans');
      data.drawings = {};
      data.drawingsOrder = [];
      const paragraphs = [
        'Autumn plans',
        'A weekend away, a few good meals, and room for a change of plans.',
        'Leave after breakfast. Take the coast road and stop somewhere for lunch.',
        'Make time for a long walk and the little bookshop near the harbor.',
      ];
      const stream = paragraphs.join('\r') + '\r\n';
      data.body = {
        ...data.body,
        dataStream: stream,
        paragraphs: Array.from(stream.matchAll(/\r/g), (match, index) => ({
          startIndex: match.index!,
          paragraphId: `presence-paragraph-${index}`,
          paragraphStyle: { spaceAbove: { v: 8 }, spaceBelow: { v: 12 } },
        })),
        textRuns: [{ st: 0, ed: paragraphs[0]!.length, ts: { fs: 24, bl: 1 } }],
        sectionBreaks: [{ sectionId: 'presence-section', startIndex: stream.length - 1 }],
      };
      const doc = created.univerAPI.createDocument(data);
      await editorReady(created.univerAPI);
      if (disposed) return;
      await documentReady(univer, id, abort.signal);
      if (disposed) return;
      cleanups.push(bindEditorTheme(univer));
      const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(id)!;
      render.engine.getCanvasElement().setAttribute('aria-label', 'Document canvas');
      created.univerAPI.getActiveDocument()!.setSelection(0, 0);
      const selections = univer.__getInjector().get(DocSelectionManagerService);
      const nativeSelections = render.with(DocSelectionRenderService);
      const fixtureHost = host.current!;
      const observeLocal = () =>
        localSelectionObservation(
          nativeSelections,
          selections.getSelectionInfo({ unitId: id, subUnitId: id }),
          doc.getDocumentDataModel().getSnapshot(),
        );
      localColorFixtures.set(fixtureHost, {
        input: nativeSelections.inputElement,
        textBounds: () =>
          calcDocRangePositions(
            { startOffset: 0, endOffset: 1, collapsed: false, segmentId: '', segmentPage: -1 },
            render,
          ),
        restyle(color) {
          // Keep both observations in the same task: a later layout publication
          // must not rescue a host that the color replacement moved to (0, 0).
          const before = observeLocal();
          setLocalDocSelectionColor(created.univer, id, color);
          return { before, after: observeLocal() };
        },
      });
      cleanups.push(() => localColorFixtures.delete(fixtureHost));
      const listeners = new Set<(state: SyncPresenceState) => void>();
      let state: SyncPresenceState = {
        selfId: 'self-session',
        connected: !disconnected,
        members: [],
      };
      const members = (remoteSelection: string) => [
        {
          id: 'self-session',
          name: guest ? 'Collaborator' : 'Sam Rivera',
          avatar: guest ? '' : profileAvatar({ icon: 'lucide:plant-pot', color: 'success-strong' }),
        },
        {
          id: 'peer-session',
          name: guest ? 'Guest' : 'Alex Kim',
          avatar: guest ? '' : profileAvatar({ icon: 'lucide:music', color: 'info-strong' }),
          selection: remoteSelection,
        },
      ];
      const initial = selection ? '13:35:1:TEXT::-1' : '13:13:1:TEXT::-1';
      state.members = disconnected ? [] : members(initial);
      change.current = (connected, remoteSelection) => {
        state = { ...state, connected, members: connected ? members(remoteSelection) : [] };
        onConnectedChange(connected);
        for (const listener of listeners) listener(state);
      };
      cleanups.push(
        setSyncPresence(univer, id, {
          subscribe(listener) {
            listeners.add(listener);
            listener(state);
            return () => listeners.delete(listener);
          },
          setCursor() {
            /* Local fixture: no socket and no durable-save claim. */
          },
        }),
      );
      const stopPresence = await watchPresence(univer, created.univerAPI, id, (values) => {
        if (disposed) return;
        setPeople(values);
        const local = selections.getSelectionInfo({ unitId: id, subUnitId: id })?.textRanges[0];
        const remote = values.find((value) => value.id === 'peer-session');
        const colors = presenceRenderColors(guest ? remote?.color : 'info-strong', 'remote');
        const shapes = render.scene
          .getAllObjects()
          .filter(
            (object) =>
              remote &&
              object.visible &&
              ((object instanceof Rect && object.stroke === colors?.stroke) ||
                (object instanceof RegularPolygon && object.fill === colors?.fill)),
          );
        setObservation(
          JSON.stringify({
            local: local ? [local.startOffset, local.endOffset] : [],
            remoteShapes: shapes.length,
            remoteSelection: remote?.selection,
          }),
        );
      });
      if (disposed) {
        stopPresence();
        return;
      }
      cleanups.push(stopPresence);
      setReady(true);
    })().catch((cause: unknown) => {
      if (!disposed) {
        setError(cause instanceof Error ? cause.message : String(cause));
        release();
      }
    });
    return release;
  }, [selection, guest, disconnected, onConnectedChange]);
  return (
    <>
      {chrome?.toolsTarget && createPortal(<Collaborators people={people} />, chrome.toolsTarget)}
      <SaveStatus
        state={{ dirty: false, failed: false, message: 'All changes saved.' }}
        target={chrome?.saveTarget ?? null}
        onRetry={() => {}}
      />
      <div className="rd-native-story-content">
        <details className="rd-native-review-tools">
          <summary>Presence review controls</summary>
          <p>
            Local room fixtures on the native Doc canvas. No account, server or saved document is
            used.
          </p>
          <button className="sp-control" onClick={() => change.current(true, '36:48:1:TEXT::-1')}>
            Move remote selection
          </button>
          <button className="sp-control" onClick={() => change.current(false, '')}>
            Disconnect room
          </button>
          <button className="sp-control" onClick={() => change.current(true, '13:35:1:TEXT::-1')}>
            Reconnect room
          </button>
        </details>
        <output hidden data-native-presence>
          {observation}
        </output>
        <section
          className="rd-native-editor"
          aria-label="Document editor"
          data-native-ready={ready}
          data-presence-ready={ready}
          aria-busy={!ready && !error}
        >
          <div className="rd-native-host" ref={host} />
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
    </>
  );
}

function NativePresenceStory(props: PresenceStoryProps) {
  const [connected, setConnected] = useState(!props.disconnected);
  useEffect(() => setConnected(!props.disconnected), [props.disconnected]);
  return (
    <div className="sp-ui rd-native-story">
      <EditorFrame
        name="Autumn plans"
        connection={connected ? 'online' : 'offline'}
        access="Can edit"
        guest={props.guest}
      >
        <NativePresenceCanvas {...props} onConnectedChange={setConnected} />
      </EditorFrame>
    </div>
  );
}

const meta = {
  id: 'editor-presence-native',
  title: 'Current production/Editor/Native presence',
  component: NativePresenceStory,
  parameters: { shell: 'none', layout: 'fullscreen' },
} satisfies Meta<typeof NativePresenceStory>;
export default meta;
type Story = StoryObj<typeof meta>;

async function ready(canvasElement: HTMLElement) {
  await waitFor(
    () =>
      expect(
        within(canvasElement).getByRole('region', { name: 'Document editor' }),
      ).toHaveAttribute('data-presence-ready', 'true'),
    { timeout: 35_000 },
  );
  await expect(within(canvasElement).queryByRole('alert')).not.toBeInTheDocument();
}
async function rendered(canvasElement: HTMLElement, name: string) {
  await ready(canvasElement);
  await waitFor(() =>
    expect(document.querySelector('[data-presence-label]')).toHaveTextContent(name),
  );
  await waitFor(() => {
    const value = JSON.parse(canvasElement.querySelector('[data-native-presence]')!.textContent!);
    expect(value.local).toEqual([0, 0]);
    expect(value.remoteShapes).toBe(1);
  });
}

export const Doc: Story = { play: ({ canvasElement }) => rendered(canvasElement, 'Alex Kim') };
export const DocSelection: Story = { args: { selection: true }, play: Doc.play };
export const DocGuest: Story = {
  args: { guest: true, selection: true },
  play: ({ canvasElement }) => rendered(canvasElement, 'Guest'),
};
export const DocDisconnected: Story = {
  args: { disconnected: true },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    await expect(document.querySelector('[data-presence-label]')).not.toBeInTheDocument();
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'People in this document' }),
    );
    await expect(await within(document.body).findByText('No one is connected yet.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
  },
};
export const DocLifecycle: Story = {
  args: { selection: true },
  play: async ({ canvasElement }) => {
    await rendered(canvasElement, 'Alex Kim');
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Presence review controls'));
    await userEvent.click(canvas.getByRole('button', { name: 'Move remote selection' }));
    await waitFor(() =>
      expect(
        JSON.parse(canvasElement.querySelector('[data-native-presence]')!.textContent!)
          .remoteSelection,
      ).toBe('36:48:1:TEXT::-1'),
    );
    await rendered(canvasElement, 'Alex Kim');
    await userEvent.click(canvas.getByRole('button', { name: 'Disconnect room' }));
    await waitFor(() =>
      expect(document.querySelector('[data-presence-label]')).not.toBeInTheDocument(),
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Reconnect room' }));
    await rendered(canvasElement, 'Alex Kim');
    await userEvent.click(canvas.getByText('Presence review controls'));
  },
};

export const DocLocalColors: Story = {
  // Isolate the immediate adapter call from the room's periodic color update.
  // This uses the desktop preset, including in narrow Storybook viewports.
  args: { disconnected: true },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = within(canvasElement);
    const fixture = localColorFixtures.get(
      canvasElement.querySelector<HTMLElement>('.rd-native-host')!,
    )!;
    const nativeCanvas = canvas.getByLabelText('Document canvas') as HTMLCanvasElement;

    // Move focus out of the fixture's initial selection before the real canvas
    // click, so that click cannot inherit focus from fixture setup.
    await userEvent.click(canvas.getByText('Presence review controls'));
    const external = canvas.getByRole('button', { name: 'Disconnect room' });
    await userEvent.click(external);
    await expect(external).toHaveFocus();
    const unfocused = fixture.restyle('#654321');
    expect(unfocused.before.focused).toBe(false);
    expect(unfocused.before.style.stroke).not.toBe('#654321');
    expect(unfocused.after).toMatchObject({
      focused: false,
      native: unfocused.before.native,
      logical: unfocused.before.logical,
      snapshot: unfocused.before.snapshot,
      style: { stroke: '#654321', fill: '#65432118' },
    });
    await expect(external).toHaveFocus();
    await userEvent.click(canvas.getByText('Presence review controls'));
    await expect(fixture.input).not.toHaveFocus();

    const coords = await waitFor(() => {
      const bounds = fixture.textBounds()?.[0];
      if (!bounds) throw new Error('The first native glyph has not been laid out.');
      const visible = nativeCanvas.getBoundingClientRect();
      const left = Math.max(bounds.left, visible.left + 1);
      const right = Math.min(bounds.right, visible.right - 1);
      const top = Math.max(bounds.top, visible.top + 1);
      const bottom = Math.min(bounds.bottom, visible.bottom - 1);
      expect(right).toBeGreaterThan(left);
      expect(bottom).toBeGreaterThan(top);
      const clientX = (left + right) / 2;
      const clientY = (top + bottom) / 2;
      return {
        clientX,
        clientY,
        offsetX: ((clientX - visible.left) * nativeCanvas.clientWidth) / visible.width,
        offsetY: ((clientY - visible.top) * nativeCanvas.clientHeight) / visible.height,
        pageX: clientX + window.scrollX,
        pageY: clientY + window.scrollY,
      };
    });
    await userEvent.pointer({ target: nativeCanvas, keys: '[MouseLeft]', coords });
    await expect(fixture.input).toHaveFocus();

    const { before, after } = fixture.restyle('#123456');
    const visible = nativeCanvas.getBoundingClientRect();
    expect(before).toMatchObject({ focused: true, pointer: false, pending: false });
    expect(before.native).not.toBeNull();
    expect(before.anchor?.visible).toBe(true);
    expect(before.host.x).toBeGreaterThanOrEqual(visible.left);
    expect(before.host.x).toBeLessThan(visible.right);
    expect(before.host.y).toBeGreaterThanOrEqual(visible.top);
    expect(before.host.y).toBeLessThan(visible.bottom);
    expect(before.style.stroke).not.toBe('#123456');
    expect(after).toMatchObject({
      focused: true,
      host: before.host,
      native: before.native,
      anchor: before.anchor,
      logical: before.logical,
      snapshot: before.snapshot,
      style: { stroke: '#123456', fill: '#12345618' },
    });
  },
};
