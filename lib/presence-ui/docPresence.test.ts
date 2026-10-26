import { beforeEach, expect, test, vi } from 'vitest';
import { DOC_RANGE_TYPE, RANGE_DIRECTION, type Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { DocSelectionManagerService, DocSkeletonManagerService } from '@univerjs/docs';
import {
  DocCanvasPopManagerService,
  DocIMEInputManagerService,
  DocSelectionRenderService,
  getTextRangeFromCharIndex,
} from '@univerjs/docs-ui';
import { Documents, IRenderManagerService } from '@univerjs/engine-render';
import { ComponentManager } from '@univerjs/ui';
import { drawPresence, setLocalDocSelectionColor } from './index.ts';

vi.mock('@univerjs/sheets-ui/facade', () => ({}));
vi.mock('@univerjs/sheets-ui', () => ({
  BaseSelectionRenderService: class {},
  ISheetSelectionRenderService: Symbol('sheet-selection'),
}));
vi.mock('@univerjs/docs', () => ({
  DocSelectionManagerService: Symbol('doc-selections'),
  DocSkeletonManagerService: Symbol('doc-skeleton'),
}));
vi.mock('@univerjs/engine-render', () => ({
  IRenderManagerService: Symbol('render'),
  Documents: class {},
}));
vi.mock('@univerjs/docs-ui', () => ({
  DocCanvasPopManagerService: Symbol('doc-popups'),
  DocSelectionRenderService: Symbol('doc-selection-render'),
  DocIMEInputManagerService: Symbol('doc-ime'),
  getTextRangeFromCharIndex: vi.fn(),
}));
vi.mock('@univerjs/ui', () => ({ ComponentManager: Symbol('components') }));

beforeEach(() => vi.clearAllMocks());

function fixture() {
  const disposed: string[] = [];
  const rangeDispose = vi.fn(() => disposed.push('range'));
  const popupDispose = vi.fn(() => disposed.push('popup'));
  const registrationDispose = vi.fn(() => disposed.push('component'));
  vi.mocked(getTextRangeFromCharIndex).mockReturnValue({ dispose: rangeDispose } as never);
  const attachPopupToRange = vi.fn(() => ({ dispose: popupDispose }));
  const register = vi.fn<(name: string, component: unknown) => { dispose: () => void }>(() => ({
    dispose: registrationDispose,
  }));
  const info = {
    textRanges: [
      {
        startOffset: 3,
        endOffset: 6,
        collapsed: false,
        rangeType: DOC_RANGE_TYPE.TEXT,
        direction: RANGE_DIRECTION.BACKWARD,
        isActive: true,
        segmentId: '',
        segmentPage: -1,
        style: {
          stroke: 'transparent',
          strokeActive: '#000000',
          fill: '#00000030',
          strokeWidth: 1,
        },
      },
    ],
    rectRanges: [],
    segmentId: '',
    segmentPage: -1,
    isEditing: true,
    options: { preserveCaret: true },
    style: { stroke: 'transparent', strokeActive: '#000000', fill: '#00000030', strokeWidth: 1 },
  };
  const selections = {
    isOnPointerEvent: false,
    hasPendingSelection: false,
    replaceDocRanges: vi.fn((ranges: typeof info.textRanges) => {
      info.textRanges = ranges;
    }),
  };
  const composition = { getCompositionRange: vi.fn(() => null) };
  const getSelectionInfo = vi.fn(() => info);
  const skeleton = {};
  const render = {
    scene: {},
    mainComponent: Object.create(Documents.prototype),
    with: (token: unknown) => {
      if (token === DocSkeletonManagerService) return { getSkeleton: () => skeleton };
      if (token === DocSelectionRenderService) return selections;
      if (token === DocIMEInputManagerService) return composition;
      throw new Error('Unexpected render service');
    },
  };
  const univer = {
    __getInjector: () => ({
      get: (token: unknown) => {
        if (token === IRenderManagerService) return { getRenderUnitById: () => render };
        if (token === ComponentManager) return { register };
        if (token === DocCanvasPopManagerService) return { attachPopupToRange };
        if (token === DocSelectionManagerService) return { getSelectionInfo };
        throw new Error('Unexpected root service');
      },
    }),
  } as unknown as Univer;
  const setSelection = vi.fn();
  const api = {
    getActiveDocument: () => ({
      getId: () => 'doc',
      setSelection,
      getDocumentDataModel: () => ({
        getSnapshot: () => ({ body: { dataStream: 'A short note\r\n' } }),
      }),
    }),
  } as unknown as FUniver;
  return {
    univer,
    api,
    render,
    skeleton,
    disposed,
    rangeDispose,
    popupDispose,
    registrationDispose,
    register,
    attachPopupToRange,
    info,
    selections,
    composition,
    getSelectionInfo,
    setSelection,
  };
}

test('remote Doc ranges use independent geometry and passive, bounded profile popups', () => {
  const f = fixture();
  const label = () => null;
  const colors = { stroke: 'host-profile.0', fill: 'host-profile.2' };
  const remote = drawPresence(f.univer, f.api, 'doc', '2:8:1:TEXT::-1', '#123456', label, colors, {
    zIndex: 60,
  });
  expect(getTextRangeFromCharIndex).toHaveBeenCalledWith(
    2,
    8,
    f.render.scene,
    f.render.mainComponent,
    f.skeleton,
    { strokeWidth: 2, stroke: colors.stroke, strokeActive: colors.stroke, fill: colors.fill },
    '',
    -1,
  );
  expect(f.register).toHaveBeenCalledWith(expect.stringMatching(/^spinel-presence-/), label);
  expect(f.attachPopupToRange).toHaveBeenCalledWith(
    {
      startOffset: 2,
      endOffset: 8,
      collapsed: false,
      segmentId: '',
      segmentPage: -1,
      rangeType: 'TEXT',
    },
    expect.objectContaining({
      componentKey: f.register.mock.calls[0]![0],
      zIndex: 60,
      hideOnInvisible: true,
      constrainToCanvas: true,
      requiresStableLayout: false,
    }),
    'doc',
  );
  expect(f.getSelectionInfo).not.toHaveBeenCalled();
  expect(f.selections.replaceDocRanges).not.toHaveBeenCalled();
  expect(f.setSelection).not.toHaveBeenCalled();
  remote.dispose();
  remote.dispose();
  expect(f.disposed).toEqual(['popup', 'component', 'range']);
});

test('invalid, inactive and unresolved Doc positions create no popup', () => {
  const f = fixture();
  const label = () => null;
  for (const value of ['8:2:1:TEXT::-1', '0:9000:1:TEXT::-1', '1:2:1:TEXT:header:-1'])
    drawPresence(f.univer, f.api, 'doc', value, '#123456', label).dispose();
  drawPresence(f.univer, f.api, 'other', '0:0:1:TEXT::-1', '#123456', label).dispose();
  expect(getTextRangeFromCharIndex).not.toHaveBeenCalled();
  vi.mocked(getTextRangeFromCharIndex).mockReturnValue(undefined);
  drawPresence(f.univer, f.api, 'doc', '1:1:1:TEXT::-1', '#123456', label).dispose();
  expect(f.register).not.toHaveBeenCalled();
  expect(f.attachPopupToRange).not.toHaveBeenCalled();
});

test('each remote Doc session owns only its own range, label registration and popup', () => {
  const f = fixture();
  const firstRange = vi.fn(),
    secondRange = vi.fn();
  const firstPopup = vi.fn(),
    secondPopup = vi.fn();
  const firstLabel = vi.fn(),
    secondLabel = vi.fn();
  vi.mocked(getTextRangeFromCharIndex)
    .mockReturnValueOnce({ dispose: firstRange } as never)
    .mockReturnValueOnce({ dispose: secondRange } as never);
  f.attachPopupToRange
    .mockReturnValueOnce({ dispose: firstPopup })
    .mockReturnValueOnce({ dispose: secondPopup });
  f.register
    .mockReturnValueOnce({ dispose: firstLabel })
    .mockReturnValueOnce({ dispose: secondLabel });
  const first = drawPresence(f.univer, f.api, 'doc', '1:1:1:TEXT::-1', '#123456', () => null);
  const second = drawPresence(f.univer, f.api, 'doc', '2:8:1:TEXT::-1', '#123456', () => null);
  expect(f.register.mock.calls[0]![0]).not.toBe(f.register.mock.calls[1]![0]);
  first.dispose();
  expect(firstRange).toHaveBeenCalledOnce();
  expect(firstPopup).toHaveBeenCalledOnce();
  expect(firstLabel).toHaveBeenCalledOnce();
  expect(secondRange).not.toHaveBeenCalled();
  expect(secondPopup).not.toHaveBeenCalled();
  expect(secondLabel).not.toHaveBeenCalled();
  second.dispose();
  expect(secondRange).toHaveBeenCalledOnce();
});

test('a failed Doc popup releases its already-created renderer and component', () => {
  const f = fixture();
  f.attachPopupToRange.mockImplementation(() => {
    throw new Error('Layout changed');
  });
  expect(() =>
    drawPresence(f.univer, f.api, 'doc', '1:1:1:TEXT::-1', '#123456', () => null),
  ).toThrow('Layout changed');
  expect(f.disposed).toEqual(['component', 'range']);
});

test('local Doc colors preserve selection, direction and focus without document writes', () => {
  const f = fixture();
  const before = structuredClone(f.info.textRanges[0]);
  const colors = { stroke: 'host-profile.0', fill: 'host-profile.3' };
  setLocalDocSelectionColor(f.univer, 'doc', '#123456', colors);
  expect(f.selections.replaceDocRanges).toHaveBeenCalledWith(
    [{ ...before, style: { ...before.style, strokeActive: colors.stroke, fill: colors.fill } }],
    true,
    { preserveCaret: true, shouldFocus: false },
  );
  expect(f.setSelection).not.toHaveBeenCalled();
  setLocalDocSelectionColor(f.univer, 'doc', '#123456', colors);
  expect(f.selections.replaceDocRanges).toHaveBeenCalledTimes(1);
});

test('local Doc restyling waits for pointer, pending layout and IME ranges', () => {
  const f = fixture();
  f.selections.isOnPointerEvent = true;
  setLocalDocSelectionColor(f.univer, 'doc', '#123456');
  f.selections.isOnPointerEvent = false;
  f.selections.hasPendingSelection = true;
  setLocalDocSelectionColor(f.univer, 'doc', '#123456');
  f.selections.hasPendingSelection = false;
  f.composition.getCompositionRange.mockReturnValue({} as never);
  setLocalDocSelectionColor(f.univer, 'doc', '#123456');
  expect(f.selections.replaceDocRanges).not.toHaveBeenCalled();
});
