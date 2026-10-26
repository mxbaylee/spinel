import {
  DependentOn,
  DocumentFlavor,
  Inject,
  Injector,
  isInternalEditorID,
  Plugin,
  UniverInstanceType,
} from '@univerjs/core';
import { DocViewScaleService } from '@univerjs/docs-ui';
import { IRenderManagerService, UniverRenderEnginePlugin } from '@univerjs/engine-render';

class PhoneDocViewScaleService extends DocViewScaleService {
  private usesPhoneLayout() {
    return (
      !isInternalEditorID(this._context.unitId) &&
      this._context.unit.getSnapshot().documentStyle.documentFlavor === DocumentFlavor.MODERN
    );
  }

  override getUserZoomRatio() {
    return this.usesPhoneLayout() ? 1 : super.getUserZoomRatio();
  }

  override getFitToWidthScale() {
    // Embedded editors keep the mobile SDK's unscaled fit; paged Docs retain
    // the configured fit-to-width behavior from the public base service.
    if (isInternalEditorID(this._context.unitId) || this.usesPhoneLayout()) return 1;
    return super.getFitToWidthScale();
  }

  override getViewScale(userZoomRatio?: number) {
    // Modern phone pages already reflow to the screen. Keep their local scale
    // readable without changing the zoom saved in the shared document. Native
    // zoom controllers also pass that saved zoom explicitly during layout.
    return this.usesPhoneLayout() ? 1 : super.getViewScale(userZoomRatio);
  }
}

/** Register in the mobile preset before creating its first document. */
export class DocPhoneViewPlugin extends Plugin {
  static override pluginName = 'SPINEL_DOC_PHONE_VIEW';
  protected _injector: Injector;

  constructor(_config: unknown, injector: Injector) {
    super();
    this._injector = injector;
  }

  override onStarting() {
    // Render modules retain the first registration for an identifier. Register
    // before the mobile Docs plugin supplies its default in onReady.
    this.disposeWithMe(
      this._injector
        .get(IRenderManagerService)
        .registerRenderModule(UniverInstanceType.UNIVER_DOC, [
          DocViewScaleService,
          { useClass: PhoneDocViewScaleService },
        ]),
    );
  }
}

Inject(Injector)(DocPhoneViewPlugin, undefined, 1);
DependentOn(UniverRenderEnginePlugin)(DocPhoneViewPlugin);
