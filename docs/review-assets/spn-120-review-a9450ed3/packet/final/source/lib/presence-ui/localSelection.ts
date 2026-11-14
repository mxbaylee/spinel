import { ThemeService, type Univer } from '@univerjs/core';
import { IRenderManagerService } from '@univerjs/engine-render';
import { ISheetSelectionRenderService, BaseSelectionRenderService } from '@univerjs/sheets-ui';
import { DocSelectionManagerService } from '@univerjs/docs';
import { DocIMEInputManagerService, DocSelectionRenderService } from '@univerjs/docs-ui';
import type { PresenceRenderColors } from './renderColors.ts';

const selectionThemeColors = new WeakMap<BaseSelectionRenderService, string>();
/** Only the normal local selection changes; formulas and copied ranges retain SDK styling. */
export function setLocalSelectionColor(
  univer: Univer,
  unitId: string,
  color: string,
  renderColors?: PresenceRenderColors,
) {
  const injector = univer.__getInjector();
  const render = injector.get(IRenderManagerService).getRenderUnitById(unitId);
  if (!render) return;
  const selections = render.with(ISheetSelectionRenderService);
  if (!(selections instanceof BaseSelectionRenderService)) return;
  if (
    selections.isSelectionDisabled() ||
    selections.inRefSelectionMode() ||
    selections.selectionMoving
  )
    return;
  const controls = selections.getSelectionControls();
  const { stroke, fill } = renderColors ?? { stroke: color, fill: color + '18' };
  if (selectionThemeColors.get(selections) !== color) {
    const theme = injector.get(ThemeService).getCurrentTheme();
    // The SDK derives additional colors from this literal. Canvas tokens belong
    // on controls only; they are not inputs to its color arithmetic.
    selections.setSelectionTheme({ ...theme, primary: { ...theme.primary, 600: color } });
    selectionThemeColors.set(selections, color);
  }
  for (const control of controls) {
    if (control.currentStyle.stroke === stroke && control.currentStyle.fill === fill) continue;
    // Mobile controls replace rather than merge their style; retain all geometry.
    control.updateStyle({
      ...control.currentStyle,
      stroke,
      fill,
      rowHeaderStroke: stroke,
      columnHeaderStroke: stroke,
      rowHeaderFill: fill,
      columnHeaderFill: fill,
    });
  }
}

const stylingDocSelections = new WeakSet<DocSelectionRenderService>();

/** Rebuild only local text controls, preserving offsets, direction and keyboard focus. */
export function setLocalDocSelectionColor(
  univer: Univer,
  unitId: string,
  color: string,
  renderColors?: PresenceRenderColors,
) {
  const injector = univer.__getInjector();
  const render = injector.get(IRenderManagerService).getRenderUnitById(unitId);
  if (!render) return;
  const selections = render.with(DocSelectionRenderService);
  // Restyling cannot interrupt a drag, IME composition or a layout-restoration selection.
  if (
    stylingDocSelections.has(selections) ||
    selections.isOnPointerEvent ||
    selections.hasPendingSelection ||
    render.with(DocIMEInputManagerService).getCompositionRange()
  )
    return;
  const info = injector
    .get(DocSelectionManagerService)
    .getSelectionInfo({ unitId, subUnitId: unitId });
  if (info?.textRanges.length !== 1 || info.rectRanges.length) return;
  const { stroke, fill } = renderColors ?? { stroke: color, fill: color + '18' };
  if (
    info.textRanges.every(
      (range) => range.style?.strokeActive === stroke && range.style.fill === fill,
    )
  )
    return;
  stylingDocSelections.add(selections);
  try {
    const hadFocus = selections.hasFocus();
    const replaced = selections.replaceDocRanges(
      info.textRanges.map((range) => ({
        ...range,
        style: { ...(range.style ?? info.style), strokeActive: stroke, fill },
      })),
      info.isEditing,
      { ...info.options, shouldFocus: false },
    );
    // Native replacement deactivates the DOM host even when focus is preserved.
    // Recompute its position from the new range only while this editor still
    // owns focus; external controls and mobile reading must not regain it.
    if (replaced && hadFocus && selections.hasFocus()) selections.sync();
  } finally {
    stylingDocSelections.delete(selections);
  }
}
