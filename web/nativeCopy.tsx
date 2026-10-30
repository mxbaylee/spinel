import { CommandType, Inject, Injector, ICommandService, Plugin } from '@univerjs/core';
import {
  ComponentManager,
  IDialogService,
  IMenuManagerService,
  IMessageService,
  MenuItemType,
  MenuManagerPosition,
  RibbonPosition,
  RibbonStartGroup,
} from '@univerjs/ui';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { BehaviorSubject } from 'rxjs';
import { MessageType } from '@univerjs/design';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import type { SaveState } from '../src/shared/autosave.ts';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { CopyFileForm } from './CopyFile.tsx';

export const MAKE_COPY_COMMAND = 'spinel.command.make-copy';
const dialogId = 'spinel.make-copy';

export function copyUnavailable(state: SaveState, initialized: boolean, online: boolean) {
  if (!initialized) return 'Wait for the document to finish opening.';
  if (!online) return 'Reconnect before making a copy.';
  if (state.dirty) return 'Finish your edit and wait for changes to save before making a copy.';
  if (state.failed || (state.local && state.local !== 'synced'))
    return 'Save or recover your changes before making a copy.';
  return null;
}

interface NativeCopyConfig {
  id: string;
  spaceId?: string;
  unavailable: BehaviorSubject<string | null>;
}

function NativeCopyForm({
  config,
  close,
  onBusy,
  created,
  onCreated,
  onSettled,
}: {
  config: NativeCopyConfig;
  close: () => void;
  onBusy: (busy: boolean) => void;
  created?: WorkspaceItem;
  onCreated: (item: WorkspaceItem) => void;
  onSettled: (result: { item: WorkspaceItem } | { error: string }) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The native mobile drawer does not connect its visual title to its dialog.
    // Name only this addon-owned overlay, without changing SDK controls.
    const dialog = content.current?.closest('[role="dialog"]');
    if (dialog && !dialog.hasAttribute('aria-labelledby'))
      dialog.setAttribute('aria-label', 'Make a copy');
  }, []);
  const unavailable = useSyncExternalStore(
    (changed) => {
      const subscription = config.unavailable.subscribe(changed);
      return () => subscription.unsubscribe();
    },
    () => config.unavailable.value,
  );
  return (
    <div ref={content}>
      <CopyFileForm
        id={config.id}
        spaceId={config.spaceId}
        unavailable={unavailable}
        canSubmit={() => config.unavailable.value === null}
        onBusy={onBusy}
        onClose={close}
        initialCreated={created}
        onCreated={onCreated}
        onSettled={onSettled}
      />
    </div>
  );
}

/** A native menu/command/dialog addon shared by Docs, Sheets and phone presets. */
export class NativeCopyPlugin extends Plugin {
  static override pluginName = 'SPINEL_NATIVE_COPY';
  protected _injector: Injector;
  private config: NativeCopyConfig;

  constructor(config: NativeCopyConfig, injector: Injector) {
    super();
    this.config = config;
    this._injector = injector;
  }

  override onRendered() {
    const dialogs = this._injector.get(IDialogService);
    const messages = this._injector.get(IMessageService);
    let open = false;
    let active = true;
    let created: WorkspaceItem | undefined;
    let generation = 0;
    const busy = new BehaviorSubject(false);
    const close = () => {
      dialogs.close(dialogId);
      open = false;
      if (!busy.value) created = undefined;
    };
    this.disposeWithMe({
      dispose: () => {
        active = false;
        close();
        busy.complete();
      },
    });
    this.disposeWithMe(
      this._injector
        .get(ComponentManager)
        .register('SpinelMakeCopyIcon', () => <ProfileIcon icon="lucide:copy-plus" size={18} />),
    );
    this.disposeWithMe(
      this._injector.get(ICommandService).registerCommand({
        id: MAKE_COPY_COMMAND,
        type: CommandType.OPERATION,
        handler: () => {
          if (busy.value) return false;
          if (open) return true;
          open = true;
          dialogs.open({
            id: dialogId,
            title: { title: 'Make a copy' },
            children: {
              title: (
                <NativeCopyForm
                  key={++generation}
                  config={this.config}
                  close={close}
                  created={created}
                  onBusy={(value) => busy.next(value)}
                  onSettled={(result) => {
                    if (!active) return;
                    if ('item' in result) created = result.item;
                    if (!open)
                      messages.show({
                        type: 'item' in result ? MessageType.Success : MessageType.Error,
                        content: 'item' in result ? `Created ${result.item.name}.` : result.error,
                      });
                  }}
                  onCreated={(item) => {
                    // Recheck after asynchronous publication, including when an
                    // explicit Open copy resumes a dismissed phone drawer.
                    if (active && open && this.config.unavailable.value === null)
                      location.assign(`/?item=${encodeURIComponent(item.id)}`);
                  }}
                />
              ),
            },
            width: 'min(480px, calc(100vw - 32px))',
            className: 'spinel-copy-dialog',
            mask: true,
            maskClosable: false,
            draggable: false,
            closable: false,
            keyboard: true,
            onClose: close,
          });
          return true;
        },
      }),
    );
    this._injector.get(IMenuManagerService).mergeMenu({
      [MenuManagerPosition.RIBBON]: {
        [RibbonPosition.START]: {
          [RibbonStartGroup.OTHERS]: {
            [MAKE_COPY_COMMAND]: {
              order: 10,
              menuItemFactory: () => ({
                id: MAKE_COPY_COMMAND,
                type: MenuItemType.BUTTON,
                title: 'Make a copy',
                tooltip: 'Make a copy',
                icon: 'SpinelMakeCopyIcon',
                disabled$: busy,
              }),
            },
          },
        },
      },
    });
  }
}
Inject(Injector)(NativeCopyPlugin, undefined, 1);
