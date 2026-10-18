import type { IStyleData } from '@univerjs/core';
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
