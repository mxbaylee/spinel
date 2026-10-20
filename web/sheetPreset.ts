import {
  UniverSheetsCorePreset,
  UniverUIPlugin,
  UniverMobileUIPlugin,
  UniverSheetsUIPlugin,
  UniverSheetsMobileUIPlugin,
  UniverSheetsFormulaUIPlugin,
  UniverSheetsFormulaMobileUIPlugin,
  UniverSheetsNumfmtUIPlugin,
  UniverSheetsNumfmtMobileUIPlugin,
} from '@univerjs/preset-sheets-core';
import type { PluginCtor } from '@univerjs/core';
import type { IPreset } from '@univerjs/presets';
import type { IUniverSheetsCorePresetConfig } from '@univerjs/preset-sheets-core';

export function useMobileSheetControls() {
  return window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
}

export function sheetPreset(
  container: HTMLElement,
  mobile: boolean,
  formula?: IUniverSheetsCorePresetConfig['formula'],
): IPreset {
  const preset = UniverSheetsCorePreset({ container, formula });
  if (!mobile) return preset;
  // Select mobile UI before creating the instance. Retain the public preset's
  // model/engine configuration, including Docs UI for the sheet's text editor.
  const replacements = new Map<PluginCtor, PluginCtor>([
    [UniverUIPlugin, UniverMobileUIPlugin],
    [UniverSheetsUIPlugin, UniverSheetsMobileUIPlugin],
    [UniverSheetsFormulaUIPlugin, UniverSheetsFormulaMobileUIPlugin],
    [UniverSheetsNumfmtUIPlugin, UniverSheetsNumfmtMobileUIPlugin],
  ]);
  return {
    ...preset,
    plugins: preset.plugins.map((entry) => {
      const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined];
      const replacement = replacements.get(plugin);
      if (!replacement) return entry;
      return [
        replacement,
        plugin === UniverUIPlugin ? { ...options, disableAutoFocus: true } : options,
      ];
    }),
  };
}
