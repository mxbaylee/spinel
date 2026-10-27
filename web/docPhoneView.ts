import {
  DependentOn,
  DocumentFlavor,
  Inject,
  Injector,
  isInternalEditorID,
  Plugin,
  UniverInstanceType,
} from '@univerjs/core';
import {
  BoldMenuItemFactory,
  BulletListCommand,
  DOC_PARAGRAPH_T_EDIT_MENU_ID,
  DocViewScaleService,
  ItalicMenuItemFactory,
  OrderListCommand,
  SetInlineFormatBoldCommand,
  SetInlineFormatItalicCommand,
} from '@univerjs/docs-ui';
import type { DocSelectionRenderService } from '@univerjs/docs-ui';
import type { MobileDocSelectionRenderService } from '@univerjs/docs-ui/lib/types/services/mobile/doc-selection-render.service.d.ts';
import { IRenderManagerService, UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { ContextMenuGroup, ContextMenuPosition, IMenuManagerService } from '@univerjs/ui';

/** Only call for the public mobile preset's selection-service registration. */
export function guardPhoneDocInput(
  selection: DocSelectionRenderService,
  isReadOnly: () => boolean,
) {
  const mobile = selection as MobileDocSelectionRenderService;
  const stopEditing = () => mobile.exitMobileEditMode();
  // These public streams replay their last events; compare timestamps so a
  // previous composition-end replay cannot hide a currently active composition.
  let compositionStartedAt = -Infinity;
  let compositionEndedAt = -Infinity;
  const compositionStart = mobile.onCompositionstart$.subscribe((config) => {
    if (config) compositionStartedAt = config.event.timeStamp;
  });
  const compositionEnd = mobile.onCompositionend$.subscribe((config) => {
    if (config) compositionEndedAt = config.event.timeStamp;
  });
  // The native touch controller can focus input independently of the root
  // Edit permission. Keep read-only readers out of keyboard mode as well;
  // the existing permission service remains the mutation boundary.
  const focus = mobile.onFocus$.subscribe((config) => {
    if (isReadOnly()) {
      stopEditing();
      return;
    }
    const input = mobile.inputElement;
    const ownerDocument = input.ownerDocument;
    if (
      compositionStartedAt > compositionEndedAt ||
      !mobile.isEditing ||
      !input.isConnected ||
      !input.isContentEditable ||
      ownerDocument.activeElement !== input ||
      config.content ||
      input.textContent
    )
      return;
    const browserSelection = ownerDocument.getSelection();
    if (!browserSelection) return;
    if (
      browserSelection.anchorNode &&
      browserSelection.focusNode &&
      input.contains(browserSelection.anchorNode) &&
      input.contains(browserSelection.focusNode)
    )
      return;
    // Native focus can leave this empty input without a browser caret, so keys
    // never produce input events. Repair only that DOM caret; the native canvas
    // range still owns the document insertion point. The focus config retains
    // pre-focus content even though the SDK clears input.innerHTML before emit.
    browserSelection.collapse(input, 0);
  });
  if (isReadOnly()) stopEditing();
  return {
    stopEditing,
    dispose() {
      focus.unsubscribe();
      compositionStart.unsubscribe();
      compositionEnd.unsubscribe();
    },
  };
}

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

/** Register after the native mobile UI plugin, before creating its first document. */
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

  override onRendered() {
    // Held-touch selection dismisses the keyboard and its Format toolbar. Add
    // the native controls to that selection's drawer, retaining their live
    // document-permission, selection, and active-style observables.
    this._injector.get(IMenuManagerService).mergeMenu({
      [ContextMenuPosition.MAIN_AREA]: {
        [ContextMenuGroup.FORMAT]: {
          [SetInlineFormatBoldCommand.id]: {
            order: 1,
            menuItemFactory: BoldMenuItemFactory,
          },
          [SetInlineFormatItalicCommand.id]: {
            order: 2,
            menuItemFactory: ItalicMenuItemFactory,
          },
        },
      },
      [DOC_PARAGRAPH_T_EDIT_MENU_ID]: {
        quickBottom: {
          // In 1.1.0 this quick menu omits the custom list picker's onChange.
          // Replace only these leaves; More's separate ribbon entries keep
          // their working list pickers and native permission checks.
          [BulletListCommand.id]: { replace: true },
          [OrderListCommand.id]: { replace: true },
        },
      },
    });
  }
}

Inject(Injector)(DocPhoneViewPlugin, undefined, 1);
DependentOn(UniverRenderEnginePlugin)(DocPhoneViewPlugin);
