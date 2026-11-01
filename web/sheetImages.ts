import {
  IImageIoService,
  IURLImageService,
  ImageUploadStatusType,
  Inject,
  Injector,
  InterceptorEffectEnum,
  Plugin,
  UniverInstanceType,
} from '@univerjs/core';
import type { IURLImageService as URLImages, IImageIoServiceParam } from '@univerjs/core';
import type { IPreset } from '@univerjs/presets';
import {
  INTERCEPTOR_POINT,
  InterceptCellContentPriority,
  SheetInterceptorService,
  isCellImage,
} from '@univerjs/sheets';
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

/** Native image fitting must change display data, never the saved rich cell. */
class SheetImageLayoutPlugin extends Plugin {
  static override pluginName = 'SPINEL_SHEET_IMAGE_LAYOUT';
  static override type = UniverInstanceType.UNIVER_SHEET;
  protected _injector: Injector;

  constructor(_config: unknown, injector: Injector) {
    super();
    this._injector = injector;
  }

  override onStarting() {
    // OSS 1.1.0's image interceptor shallow-copies the cell, then changes its
    // nested drawing sizes in place. Run before it, including the first render
    // of a loaded/history image, so layout cannot cause a sync divergence.
    this.disposeWithMe(
      this._injector.get(SheetInterceptorService).intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
        effect: InterceptorEffectEnum.Style,
        priority: InterceptCellContentPriority.CELL_IMAGE + 1,
        handler(cell, _context, next) {
          return next(
            cell && isCellImage(cell.p) ? { ...cell, p: structuredClone(cell.p) } : cell,
          );
        },
      }),
    );
  }
}
Inject(Injector)(SheetImageLayoutPlugin, undefined, 1);

// History/viewers keep this refusal. Editable Sheets supply the tracked store;
// never fall back to the SDK's ephemeral data-URL upload implementation.
class ExistingSheetImages extends ImageIoService {
  override async saveImage(): Promise<never> {
    throw new Error(ImageUploadStatusType.ERROR_IMAGE);
  }
}
export const sheetImageOverride = [IImageIoService, { useClass: ExistingSheetImages }] as const;
export function sheetImages(
  mobile: boolean,
  images?: URLImages,
  upload?: (file: File) => Promise<IImageIoServiceParam>,
): IPreset {
  class StoredSheetImages extends ImageIoService {
    override saveImage(file: File) {
      return upload!(file);
    }
  }
  const preset = UniverSheetsDrawingPreset();
  preset.plugins.push(SheetImageLayoutPlugin);
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
              upload ? [IImageIoService, { useClass: StoredSheetImages }] : [...sheetImageOverride],
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
            [SHEETS_IMAGE_MENU_ID]: { hidden: !upload },
            [AddWorksheetBackgroundImageCommand.id]: { hidden: true },
          },
        },
      ];
    }),
  };
}
