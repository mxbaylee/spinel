import { IImageIoService, IURLImageService, ImageUploadStatusType } from '@univerjs/core';
import type { IURLImageService as URLImages } from '@univerjs/core';
import type { IPreset } from '@univerjs/presets';
import {
  ImageIoService,
  UniverDrawingPlugin,
  UniverDrawingUIPlugin,
  UniverDrawingMobileUIPlugin,
  UniverSheetsDrawingPreset,
  UniverSheetsDrawingUIPlugin,
  UniverSheetsDrawingMobileUIPlugin,
  SHEETS_IMAGE_MENU_ID,
  AddWorksheetBackgroundImageCommand,
} from '@univerjs/preset-sheets-drawing';
import '@univerjs/preset-sheets-drawing/lib/index.css';

// Existing embedded images arrive through native import. New upload/paste needs
// its own persistence/navigation flow; never accept ephemeral SDK data URLs.
class ExistingSheetImages extends ImageIoService {
  override async saveImage(): Promise<never> {
    throw new Error(ImageUploadStatusType.ERROR_IMAGE);
  }
}
export const sheetImageOverride = [IImageIoService, { useClass: ExistingSheetImages }] as const;
export function sheetImages(mobile: boolean, images?: URLImages): IPreset {
  const preset = UniverSheetsDrawingPreset();
  return {
    ...preset,
    plugins: preset.plugins.map((entry) => {
      const [plugin, config] = Array.isArray(entry) ? entry : [entry, undefined];
      if (plugin === UniverDrawingPlugin)
        return [
          plugin,
          {
            ...config,
            override: [
              [...sheetImageOverride],
              ...(images ? [[IURLImageService, { useValue: images }]] : []),
            ],
          },
        ];
      if (plugin === UniverDrawingUIPlugin && mobile) return [UniverDrawingMobileUIPlugin, config];
      if (plugin !== UniverSheetsDrawingUIPlugin) return entry;
      return [
        mobile ? UniverSheetsDrawingMobileUIPlugin : plugin,
        {
          ...config,
          menu: {
            [SHEETS_IMAGE_MENU_ID]: { hidden: true },
            [AddWorksheetBackgroundImageCommand.id]: { hidden: true },
          },
        },
      ];
    }),
  };
}
