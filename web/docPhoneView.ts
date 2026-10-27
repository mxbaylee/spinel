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
  DocFloatMenuService,
  DocSelectionRenderService,
  DocViewScaleService,
  ItalicMenuItemFactory,
  OrderListCommand,
  SetInlineFormatBoldCommand,
  SetInlineFormatItalicCommand,
} from '@univerjs/docs-ui';
import type { MobileDocSelectionRenderService } from '@univerjs/docs-ui/lib/types/services/mobile/doc-selection-render.service.d.ts';
import type { IRender } from '@univerjs/engine-render';
import { IRenderManagerService, UniverRenderEnginePlugin } from '@univerjs/engine-render';
import type { IContextMenuService } from '@univerjs/ui';
import { ContextMenuGroup, ContextMenuPosition, IMenuManagerService } from '@univerjs/ui';

/** Only call for the public mobile preset's selection-service registration. */
export function guardPhoneDocInput(
  render: IRender,
  contextMenus: IContextMenuService,
  isReadOnly: () => boolean,
) {
  const mobile = render.with(DocSelectionRenderService) as MobileDocSelectionRenderService;
  const selectionMenus = render.with(DocFloatMenuService);
  const input = mobile.inputElement;
  const oldMinHeight = input.style.getPropertyValue('min-height');
  const oldMinHeightPriority = input.style.getPropertyPriority('min-height');
  // Initialization makes the host inert. Keep the empty native input's line
  // box nonzero so focus can establish its browser caret after loading ends.
  input.style.setProperty('min-height', '1px');
  const stopEditing = () => mobile.exitMobileEditMode();
  // The native touch controller can focus input independently of the root
  // Edit permission. Keep read-only readers out of keyboard mode as well;
  // the existing permission service remains the mutation boundary.
  const focus = mobile.onFocus$.subscribe(() => {
    if (isReadOnly()) stopEditing();
  });
  const canvas = render.engine.getCanvasElement();
  let touchIdentifier: number | null = null;
  const touchStart = (event: TouchEvent) => {
    touchIdentifier =
      !isReadOnly() && !contextMenus.visible && event.touches.length === 1
        ? event.touches[0].identifier
        : null;
    // A deliberate backdrop dismissal closes the drawer but leaves the native
    // menu's cached range. A new gesture must be able to select that word again.
    if (touchIdentifier !== null) selectionMenus.hideFloatMenu();
  };
  const touchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) touchIdentifier = null;
  };
  const touchEnd = (event: TouchEvent) => {
    const endedIdentifier = touchIdentifier;
    touchIdentifier = null;
    const range = mobile.getActiveTextRange();
    if (
      endedIdentifier !== null &&
      event.touches.length === 0 &&
      event.changedTouches.length === 1 &&
      event.changedTouches[0].identifier === endedIdentifier &&
      !isReadOnly() &&
      contextMenus.visible &&
      range &&
      !range.collapsed &&
      event.cancelable
    )
      // The held touch has opened a drawer over its canvas target. Suppress
      // only this release's compatibility click onto the new Cancel backdrop.
      event.preventDefault();
  };
  const touchCancel = () => {
    touchIdentifier = null;
  };
  canvas.addEventListener('touchstart', touchStart, { passive: true });
  canvas.addEventListener('touchmove', touchMove, { passive: true });
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  canvas.addEventListener('touchcancel', touchCancel, { passive: true });
  if (isReadOnly()) stopEditing();
  return {
    stopEditing,
    dispose() {
      focus.unsubscribe();
      canvas.removeEventListener('touchstart', touchStart);
      canvas.removeEventListener('touchmove', touchMove);
      canvas.removeEventListener('touchend', touchEnd);
      canvas.removeEventListener('touchcancel', touchCancel);
      if (
        input.style.getPropertyValue('min-height') === '1px' &&
        !input.style.getPropertyPriority('min-height')
      ) {
        if (oldMinHeight) input.style.setProperty('min-height', oldMinHeight, oldMinHeightPriority);
        else input.style.removeProperty('min-height');
      }
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
