import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { DocSelectionManagerService, DocSkeletonManagerService } from '@univerjs/docs';
import { DocSelectionRenderService } from '@univerjs/docs-ui';
import { IRenderManagerService } from '@univerjs/engine-render';
import { serializeRange } from '@univerjs/engine-formula';
import { drawPresence, setLocalDocSelectionColor } from '@spinel/presence-ui';
import { watchPresence, type Collaborator } from '../../web/Collaborators.tsx';
import {
  getSyncPresence,
  setSyncPresence,
  type SyncPresenceState,
} from '../../web/syncPresence.ts';
import { palettes } from './palette.ts';
import { profileAvatar } from '../profile/profile.ts';

vi.mock('@univerjs/docs', () => ({
  DocSelectionManagerService: Symbol('doc-selection'),
  DocSkeletonManagerService: Symbol('doc-skeleton'),
}));
vi.mock('@univerjs/docs-ui', () => ({ DocSelectionRenderService: Symbol('doc-render-selection') }));
vi.mock('@univerjs/engine-render', () => ({ IRenderManagerService: Symbol('render') }));
vi.mock('@univerjs/sheets-ui', () => ({ SheetsScrollRenderController: Symbol('sheet-scroll') }));
vi.mock('@univerjs/engine-formula', () => ({ serializeRange: vi.fn(() => 'A1:C2') }));
vi.mock('@spinel/presence-ui', async () => ({
  ...(await import('../../lib/presence-ui/selection.ts')),
  drawPresence: vi.fn(() => ({ dispose: vi.fn() })),
  setLocalSelectionColor: vi.fn(),
  setLocalDocSelectionColor: vi.fn(),
}));
vi.mock('../profile/ProfileIcon.tsx', () => ({ ProfileIcon: () => null }));
vi.mock('./redesign/Controls.tsx', () => ({ Modal: () => null }));

const stops: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  const events = Object.assign(new EventTarget(), { setInterval: globalThis.setInterval });
  vi.stubGlobal('window', events);
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('registry is per Univer/unit and retiring cleanup preserves a replacement', () => {
  const one = {} as Univer,
    two = {} as Univer;
  const first = { subscribe: () => () => {}, setCursor: vi.fn() };
  const next = { subscribe: () => () => {}, setCursor: vi.fn() };
  const close = setSyncPresence(one, 'doc', first);
  const closeNext = setSyncPresence(one, 'doc', next);
  expect(getSyncPresence(one, 'doc')).toBe(next);
  expect(getSyncPresence(two, 'doc')).toBeUndefined();
  expect(getSyncPresence(one, 'other')).toBeUndefined();
  close();
  expect(getSyncPresence(one, 'doc')).toBe(next);
  closeNext();
  expect(getSyncPresence(one, 'doc')).toBeUndefined();
  const reused = setSyncPresence(one, 'doc', first);
  const replacement = setSyncPresence(one, 'doc', first);
  reused();
  expect(getSyncPresence(one, 'doc')).toBe(first);
  replacement();
});

async function fixture(kind: 'doc' | 'sheet' = 'doc') {
  const input = new Subject<ReturnType<typeof selection>>();
  const dirty = new Subject<boolean>();
  const skeletons = new BehaviorSubject({
    dirty$: dirty,
    layoutProgress$: new Subject(),
    layoutPageMaterialized$: new Subject(),
  });
  const activated = new BehaviorSubject(true);
  const transforms = new Subject<void>();
  const scrolling = new Subject<void>();
  const event = (subject: Subject<void>) => ({
    subscribeEvent: (callback: () => void) => subject.subscribe(callback),
  });
  const focus = vi.fn();
  const setSegment = vi.fn(),
    setSegmentPage = vi.fn();
  const render = {
    activated$: activated,
    scene: {
      onTransformChange$: event(transforms),
      getViewports: () => [{ onScrollAfter$: event(scrolling) }],
    },
    engine: { onTransformChange$: event(transforms) },
    with: (token: unknown) => {
      if (token === DocSkeletonManagerService) return { currentSkeleton$: skeletons };
      if (token === DocSelectionRenderService) return { focus, setSegment, setSegmentPage };
      return { scrollToRange: vi.fn() };
    },
  };
  const univer = {
    __getInjector: () => ({
      get: (token: unknown) => {
        if (token === IRenderManagerService) return { getRenderUnitById: () => render };
        if (token === DocSelectionManagerService)
          return { textSelection$: input, getSelectionInfo: () => selection(0, 0) };
        throw new Error('Unexpected presence service');
      },
    }),
  } as unknown as Univer;
  const setSelection = vi.fn();
  let sheetId = 'sheet';
  const sheet = {
    getSheetId: () => sheetId,
    getMaxRows: () => 10,
    getMaxColumns: () => 3,
    getActiveRange: () => ({
      getRange: () => ({ startRow: 0, endRow: 1, startColumn: NaN, endColumn: NaN }),
    }),
    getRange: () => ({
      getRange: () => ({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }),
    }),
  };
  const book = {
    getId: () => 'unit',
    getActiveSheet: () => sheet,
    getSheetBySheetId: () => sheet,
    setActiveSheet: vi.fn(),
  };
  const api = {
    getActiveDocument: () =>
      kind === 'doc'
        ? {
            getId: () => 'unit',
            setSelection,
            getDocumentDataModel: () => ({
              getSnapshot: () => ({ body: { dataStream: 'A document to share.\r\n' } }),
            }),
          }
        : undefined,
    getActiveWorkbook: () => (kind === 'sheet' ? book : undefined),
    Event: { Scroll: 'scroll' },
    addEvent: () => ({ dispose: vi.fn() }),
  } as unknown as FUniver;
  let state: SyncPresenceState = {
    connected: true,
    selfId: 'self',
    members: [
      {
        id: 'self',
        name: 'Sam',
        avatar: profileAvatar({ icon: 'lucide:plant-pot', color: 'success-strong' }),
      },
      {
        id: 'peer1',
        name: 'Alex',
        avatar: profileAvatar({ icon: 'lucide:music', color: 'info-strong' }),
        selection: kind === 'doc' ? '2:8:1:TEXT::-1' : 'sheet!A1:C2',
      },
      {
        id: 'peer2',
        name: 'Alex',
        avatar: profileAvatar({ icon: 'lucide:music', color: 'info-strong' }),
      },
    ],
  };
  const listeners = new Set<(state: SyncPresenceState) => void>();
  const setCursor = vi.fn();
  stops.push(
    setSyncPresence(univer, 'unit', {
      setCursor,
      subscribe(callback) {
        listeners.add(callback);
        callback(state);
        return () => listeners.delete(callback);
      },
    }),
  );
  let people: Collaborator[] = [];
  const publish = vi.fn((next: Collaborator[]) => {
    people = next;
  });
  const stop = await watchPresence(univer, api, 'unit', publish);
  stops.push(stop);
  await vi.advanceTimersByTimeAsync(20);
  return {
    univer,
    api,
    input,
    dirty,
    activated,
    scrolling,
    transforms,
    setSelection,
    focus,
    setSegment,
    setSegmentPage,
    setCursor,
    stop,
    publish,
    people: () => people,
    listenerCount: () => listeners.size,
    sheetId: (value: string) => {
      sheetId = value;
    },
    emit(next: Partial<SyncPresenceState>) {
      state = { ...state, ...next };
      for (const listener of listeners) listener(state);
    },
  };
}

function selection(startOffset: number, endOffset: number) {
  return {
    unitId: 'unit',
    subUnitId: 'unit',
    textRanges: [
      { startOffset, endOffset, isActive: true, rangeType: 'TEXT', segmentId: '', segmentPage: -1 },
    ],
    rectRanges: [],
    segmentId: '',
    segmentPage: -1,
    isEditing: true,
  };
}

test('Doc presence keeps sessions distinct, uses catalog profiles and follows only on request', async () => {
  const f = await fixture();
  expect(f.people().map((person) => person.id)).toEqual(['self', 'peer1', 'peer2']);
  expect(f.people()[1]).toMatchObject({
    name: 'Alex',
    color: palettes.light['fill-info-strong-bg'],
    icon: 'lucide:music',
  });
  expect(f.people()[0]!.jump).toBeUndefined();
  expect(f.setSelection).not.toHaveBeenCalled();
  expect(drawPresence).toHaveBeenCalledTimes(1);
  expect(setLocalDocSelectionColor).toHaveBeenCalled();
  f.people()[1]!.jump!();
  expect(f.setSelection).toHaveBeenCalledWith(2, 8);
  expect(f.setSegment).toHaveBeenCalledWith('');
  expect(f.setSegmentPage).toHaveBeenCalledWith(-1);
  expect(f.focus).toHaveBeenCalledOnce();
});

test('native Doc events coalesce, never send identities and clear unsupported segments', async () => {
  const f = await fixture();
  f.setCursor.mockClear();
  for (let index = 1; index < 10; index++) f.input.next(selection(index, index));
  expect(f.setCursor).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(f.setCursor.mock.calls).toEqual([['9:9:1:TEXT::-1']]);
  await vi.advanceTimersByTimeAsync(300);
  expect(f.setCursor).toHaveBeenCalledOnce();
  f.input.next({ ...selection(1, 1), segmentId: 'header' });
  await vi.advanceTimersByTimeAsync(150);
  expect(f.setCursor).toHaveBeenLastCalledWith('');
});

test('disconnect, layout, theme, navigation and disposal retire old remote ranges', async () => {
  const f = await fixture();
  const initial = vi.mocked(drawPresence).mock.results[0]!.value!;
  f.dirty.next(true);
  await vi.advanceTimersByTimeAsync(20);
  expect(initial.dispose).toHaveBeenCalledOnce();
  const afterLayout = vi.mocked(drawPresence).mock.results.at(-1)!.value!;
  window.dispatchEvent(new Event('spinel-theme'));
  f.scrolling.next();
  f.transforms.next();
  await vi.advanceTimersByTimeAsync(20);
  expect(afterLayout.dispose).toHaveBeenCalledOnce();
  f.emit({ connected: false });
  expect(f.people()).toEqual([]);
  const beforeOffline = f.setCursor.mock.calls.length;
  await vi.advanceTimersByTimeAsync(150);
  expect(f.setCursor).toHaveBeenCalledTimes(beforeOffline);
  f.emit({ connected: true });
  await vi.advanceTimersByTimeAsync(150);
  expect(f.people()).toHaveLength(3);
  expect(f.setCursor).toHaveBeenCalledTimes(beforeOffline + 1);
  f.activated.next(false);
  expect(f.people()).toEqual([]);
  f.stop();
  expect(f.listenerCount()).toBe(0);
  const published = f.publish.mock.calls.length;
  f.dirty.next(true);
  f.scrolling.next();
  window.dispatchEvent(new Event('resize'));
  await vi.advanceTimersByTimeAsync(500);
  expect(f.publish).toHaveBeenCalledTimes(published);
});

test('guest identity stays generic, invalid cursors do not draw and removed members disappear', async () => {
  const f = await fixture();
  vi.mocked(drawPresence).mockClear();
  f.emit({
    members: [
      { id: 'self', name: 'Collaborator', avatar: '' },
      { id: 'guest1', name: 'Guest', avatar: '', selection: '2:8:1:TEXT::-1' },
      { id: 'guest2', name: 'Guest', avatar: '/other/account.png', selection: '1:9999:1:TEXT::-1' },
    ],
  });
  await vi.advanceTimersByTimeAsync(20);
  expect(f.people().map((person) => person.name)).toEqual(['Collaborator', 'Guest', 'Guest']);
  expect(f.people().every((person) => person.icon === 'lucide:user-round')).toBe(true);
  expect(drawPresence).toHaveBeenCalledOnce();
  expect(f.people()[2]!.jump).toBeUndefined();
  f.emit({ members: [{ id: 'self', name: 'Collaborator', avatar: '' }] });
  await vi.advanceTimersByTimeAsync(20);
  expect(f.people()).toHaveLength(1);
});

test('Sheet header selections are bounded and overlong IDs clear instead of flooding the protocol', async () => {
  const f = await fixture('sheet');
  expect(serializeRange).toHaveBeenCalledWith(
    expect.objectContaining({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }),
  );
  expect(f.setCursor).toHaveBeenLastCalledWith('sheet!A1:C2');
  f.sheetId('x'.repeat(65));
  await vi.advanceTimersByTimeAsync(150);
  expect(f.setCursor).toHaveBeenLastCalledWith('');
  const calls = f.setCursor.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.setCursor).toHaveBeenCalledTimes(calls);
});
