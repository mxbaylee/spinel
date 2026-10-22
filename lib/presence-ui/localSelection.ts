import { ThemeService, type Univer } from '@univerjs/core';
import { IRenderManagerService } from '@univerjs/engine-render';
import { ISheetSelectionRenderService, BaseSelectionRenderService } from '@univerjs/sheets-ui';
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
