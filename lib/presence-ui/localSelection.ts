import { ThemeService, type Univer } from '@univerjs/core';
import { IRenderManagerService } from '@univerjs/engine-render';
import { SheetSelectionRenderService } from '@univerjs/sheets-ui';
/** Only the normal local selection changes; formulas and copied ranges retain SDK styling. */
export function setLocalSelectionColor(univer: Univer, unitId: string, color: string) {
  const injector = univer.__getInjector();
  const render = injector.get(IRenderManagerService).getRenderUnitById(unitId);
  if (!render) return;
  const selections = render.with(SheetSelectionRenderService);
  if (selections.isSelectionDisabled() || selections.inRefSelectionMode()) return;
  const controls = selections.getSelectionControls();
  if (controls.every((control) => control.currentStyle.stroke === color)) return;
  const theme = injector.get(ThemeService).getCurrentTheme();
  selections.setSelectionTheme({ ...theme, primary: { ...theme.primary, 600: color } });
  for (const control of controls) {
    if (control.currentStyle.stroke === color) continue;
    control.updateStyle({
      stroke: color,
      fill: color + '18',
      rowHeaderStroke: color,
      columnHeaderStroke: color,
      rowHeaderFill: color + '18',
      columnHeaderFill: color + '18',
    });
  }
}
