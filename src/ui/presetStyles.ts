import type {
  IStyleData,
  ICellDataForSheetInterceptor,
  ICellData,
  ITextStyle,
  Nullable,
} from '@univerjs/core';
import { fillPresets, palettes } from './palette.ts';
import type { ThemeMode } from './palette.ts';
export function presetStyle(id: string, mode: ThemeMode): IStyleData {
  if (!fillPresets.some((preset) => preset.id === id)) throw new Error('Unknown fill preset.');
  return {
    bg: { rgb: palettes[mode][`fill-${id}-bg`] },
    cl: { rgb: palettes[mode][`fill-${id}-fg`] },
  };
}
export function displayPresetStyle(style: IStyleData, mode: ThemeMode): IStyleData {
  const preset = fillPresets.find(
    ({ id }) =>
      style.bg?.rgb?.toLowerCase() === palettes.light[`fill-${id}-bg`] &&
      style.cl?.rgb?.toLowerCase() === palettes.light[`fill-${id}-fg`],
  );
  return preset ? { ...style, ...presetStyle(preset.id, mode) } : style;
}

// Rich-text runs carry their own foreground. Adapt a copy used by the renderer;
// leave custom run colours and all non-colour formatting intact.
export function displayPresetCell(
  cell: ICellDataForSheetInterceptor,
  style: IStyleData,
  mode: ThemeMode,
): ICellDataForSheetInterceptor {
  const display = displayPresetStyle(style, mode);
  if (display === style) return cell;
  const result = { ...cell, interceptorStyle: { ...cell.interceptorStyle, ...display } };
  if (cell.p) {
    result.p = structuredClone(cell.p);
    const adapt = (text: ITextStyle = {}) =>
      !text.cl || text.cl.rgb?.toLowerCase() === style.cl?.rgb?.toLowerCase()
        ? { ...text, cl: display.cl }
        : text;
    result.p.documentStyle = {
      ...result.p.documentStyle,
      textStyle: adapt(result.p.documentStyle?.textStyle),
    };
    if (result.p.body?.textRuns)
      result.p.body.textRuns = result.p.body.textRuns.map((run) => ({ ...run, ts: adapt(run.ts) }));
  }
  return result;
}

// Public BEFORE_CELL_EDIT receives the stored origin. Edit canonical colours,
// not display colours, so typing in dark mode cannot persist a dark-only pair.
export function presetCellForEditing(
  cell: ICellDataForSheetInterceptor,
  origin: Nullable<ICellData>,
  style: IStyleData,
): ICellDataForSheetInterceptor {
  if (displayPresetStyle(style, 'light') === style) return cell;
  return {
    ...cell,
    p: origin?.p ? structuredClone(origin.p) : undefined,
    interceptorStyle: { ...cell.interceptorStyle, ...style },
  };
}
