import { expect, test, vi } from 'vitest';
import { ThemeService, type Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { BaseSelectionRenderService } from '@univerjs/sheets-ui';
import { drawPresence, setLocalSelectionColor } from './index.ts';

vi.mock('@univerjs/sheets-ui/facade', () => ({}));
vi.mock('@univerjs/engine-render', () => ({
  IRenderManagerService: Symbol('render'),
  Documents: class {},
}));
vi.mock('@univerjs/docs', () => ({
  DocSelectionManagerService: Symbol('doc-selections'),
  DocSkeletonManagerService: Symbol('doc-skeleton'),
}));
vi.mock('@univerjs/docs-ui', () => ({
  DocCanvasPopManagerService: Symbol('doc-popups'),
  DocSelectionRenderService: Symbol('doc-selection-render'),
  DocIMEInputManagerService: Symbol('doc-ime'),
  getTextRangeFromCharIndex: vi.fn(),
}));
vi.mock('@univerjs/ui', () => ({ ComponentManager: Symbol('components') }));
vi.mock('@univerjs/sheets-ui', () => ({
  BaseSelectionRenderService: class {},
  ISheetSelectionRenderService: Symbol('selection'),
}));

test('remote highlights accept complete render colors without corrupting token fills', () => {
  const highlightDispose = vi.fn();
  const popupDispose = vi.fn();
  const highlight = vi.fn(() => ({ dispose: highlightDispose }));
  const attachPopup = vi.fn(() => ({ dispose: popupDispose }));
  const sheet = { getSheetId: () => 'sheet', getRange: () => ({ highlight, attachPopup }) };
  const api = {
    getActiveWorkbook: () => ({
      getId: () => 'book',
      getSheetBySheetId: () => sheet,
      getActiveSheet: () => sheet,
    }),
  } as unknown as FUniver;
  const label = () => null;
  const renderColors = { stroke: 'host-profile.0', fill: 'host-profile.2' };
  const disposable = drawPresence(
    {} as Univer,
    api,
    'book',
    'sheet!A1',
    '#123456',
    label,
    renderColors,
    { zIndex: 60 },
  );
  expect(highlight).toHaveBeenLastCalledWith(renderColors);
  expect(attachPopup).toHaveBeenLastCalledWith(
    expect.objectContaining({ componentKey: label, zIndex: 60 }),
  );
  disposable.dispose();
  expect(highlightDispose).toHaveBeenCalledTimes(1);
  expect(popupDispose).toHaveBeenCalledTimes(1);
  drawPresence({} as Univer, api, 'book', 'sheet!A1', '#123456', label).dispose();
  expect(highlight).toHaveBeenLastCalledWith({ stroke: '#123456', fill: '#12345628' });
  expect(attachPopup).toHaveBeenLastCalledWith(expect.objectContaining({ zIndex: undefined }));
});

test('local tokens preserve geometry, literal theme arithmetic and newly created selections', () => {
  const initialStyle = {
    stroke: '#000000',
    fill: '#00000018',
    strokeWidth: 2,
    widgets: { size: 4 },
  };
  const control = {
    currentStyle: initialStyle,
    updateStyle: vi.fn((style: typeof initialStyle) => {
      control.currentStyle = style;
    }),
  };
  const controls = [control];
  const selections = Object.assign(Object.create(BaseSelectionRenderService.prototype), {
    isSelectionDisabled: () => false,
    inRefSelectionMode: () => false,
    selectionMoving: false,
    getSelectionControls: () => controls,
    setSelectionTheme: vi.fn(),
  });
  const theme = { primary: { 600: '#000000' } };
  const univer = {
    __getInjector: () => ({
      get: (token: unknown) =>
        token === ThemeService
          ? { getCurrentTheme: () => theme }
          : { getRenderUnitById: () => ({ with: () => selections }) },
    }),
  } as unknown as Univer;
  const renderColors = { stroke: 'host-profile.0', fill: 'host-profile.3' };
  setLocalSelectionColor(univer, 'book', '#123456', renderColors);
  expect(control.currentStyle).toMatchObject({
    ...initialStyle,
    ...renderColors,
    rowHeaderStroke: renderColors.stroke,
    columnHeaderStroke: renderColors.stroke,
    rowHeaderFill: renderColors.fill,
    columnHeaderFill: renderColors.fill,
  });
  expect(selections.setSelectionTheme).toHaveBeenLastCalledWith({ primary: { 600: '#123456' } });
  setLocalSelectionColor(univer, 'book', '#123456', renderColors);
  expect(control.updateStyle).toHaveBeenCalledTimes(1);
  // A theme switch changes the literal but keeps the host token names stable.
  setLocalSelectionColor(univer, 'book', '#abcdef', renderColors);
  expect(selections.setSelectionTheme).toHaveBeenLastCalledWith({ primary: { 600: '#abcdef' } });
  // SDK-generated controls are corrected on the next host update too.
  control.currentStyle = { ...initialStyle, stroke: '#abcdef' };
  setLocalSelectionColor(univer, 'book', '#abcdef', renderColors);
  expect(control.currentStyle).toMatchObject(renderColors);
});
