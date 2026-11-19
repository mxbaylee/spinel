import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Subject } from 'rxjs';
import {
  ContextService,
  FOCUSING_COMMON_DRAWINGS,
  FOCUSING_DOC,
  FOCUSING_UNIVER_EDITOR,
  ICommandService,
  Injector,
  IUniverInstanceService,
} from '@univerjs/core';
import {
  DeleteLeftCommand,
  DeleteRightCommand,
  DocFloatMenuService,
  DocIMEInputManagerService,
  DocSelectionRenderService,
  EnterCommand,
} from '@univerjs/docs-ui';
import { IRenderManagerService } from '@univerjs/engine-render';
import type { IRender } from '@univerjs/engine-render';
import { IShortcutService, KeyCode, ShortcutService } from '@univerjs/ui';
import type { IContextMenuService } from '@univerjs/ui';
import { DocPhoneViewPlugin, guardPhoneDocInput } from '../../web/docPhoneView.ts';

const cleanups: (() => void)[] = [];
const report = vi.fn();
beforeEach(() => {
  report.mockReset();
  vi.stubGlobal('reportError', report);
  // The native shortcut service installs its normal global listener. Node's
  // EventTarget supplies dispatch/cancellation; no browser or document model
  // is simulated by these adapter tests.
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('HTMLInputElement', class {});
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
});

function fixture() {
  const properties = new Map<string, [string, string]>([['min-height', ['2px', 'important']]]);
  const input = Object.assign(new EventTarget(), {
    style: {
      getPropertyValue: (name: string) => properties.get(name)?.[0] ?? '',
      getPropertyPriority: (name: string) => properties.get(name)?.[1] ?? '',
      setProperty: (name: string, value: string, priority = '') => {
        properties.set(name, [value, priority]);
      },
      removeProperty: (name: string) => properties.delete(name),
    },
  });
  const canvas = new EventTarget();
  const focus = new Subject<void>();
  const state = {
    readOnly: false,
    focused: true,
    selected: true,
    composing: false,
    disposed: false,
    currentUnitId: 'doc' as string | undefined,
  };
  const executeCommand = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true);
  const commands = { executeCommand };
  const injector = new Injector([
    [ICommandService, { useValue: commands }],
    [
      IUniverInstanceService,
      {
        useValue: {
          getCurrentUnitOfType: () =>
            state.currentUnitId ? { getUnitId: () => state.currentUnitId } : null,
        },
      },
    ],
  ]);
  cleanups.push(() => injector.dispose());
  const exitMobileEditMode = vi.fn();
  const selection = {
    inputElement: input,
    onFocus$: focus.asObservable(),
    exitMobileEditMode,
    get isFocusing() {
      return state.focused;
    },
    getActiveTextRange: () =>
      state.selected ? { startOffset: 3, endOffset: 3, collapsed: true } : undefined,
  };
  const render = {
    unitId: 'doc',
    isDisposed: () => state.disposed,
    engine: { getCanvasElement: () => canvas },
    with: (token: unknown) => {
      if (token === DocSelectionRenderService) return selection;
      if (token === DocFloatMenuService) return { hideFloatMenu: vi.fn() };
      if (token === DocIMEInputManagerService)
        return { getActiveRange: () => (state.composing ? { startOffset: 3 } : null) };
      throw new Error('Unexpected render dependency');
    },
  } as unknown as IRender;
  const guard = guardPhoneDocInput(
    render,
    { visible: false } as IContextMenuService,
    () => state.readOnly,
    injector,
  );
  cleanups.push(() => guard.dispose());
  return {
    input,
    canvas,
    focus,
    state,
    commands,
    executeCommand,
    injector,
    guard,
    exitMobileEditMode,
  };
}

function inputEvent(
  inputType = 'deleteContentBackward',
  options: { type?: string; cancelable?: boolean; isComposing?: boolean } = {},
) {
  // Node has Event but no DOM InputEvent. Keep the real event cancellation and
  // target behavior, adding only the native input fields consumed by the bridge.
  return Object.assign(
    new Event(options.type ?? 'beforeinput', {
      bubbles: true,
      cancelable: options.cancelable ?? true,
    }),
    { inputType, isComposing: options.isComposing ?? false, data: null },
  );
}

test.each([
  ['deleteContentBackward', DeleteLeftCommand.id],
  ['deleteContentForward', DeleteRightCommand.id],
])(
  '%s dispatches once from beforeinput without waiting for input',
  async (inputType, commandId) => {
    const f = fixture();
    const event = inputEvent(inputType);
    expect(f.input.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(f.executeCommand).toHaveBeenCalledExactlyOnceWith(commandId);
    // Even a synthetic producer that sends input after cancellation cannot cause
    // another deletion; there is deliberately no second input-stage bridge.
    f.input.dispatchEvent(inputEvent(inputType, { type: 'input', cancelable: false }));
    await Promise.resolve();
    expect(f.executeCommand).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  },
);

test('distinct consecutive beforeinput edits are neither coalesced nor retried', async () => {
  const f = fixture();
  f.executeCommand.mockResolvedValue(false);
  for (let index = 0; index < 3; index++) expect(f.input.dispatchEvent(inputEvent())).toBe(false);
  await Promise.resolve();
  expect(f.executeCommand.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [DeleteLeftCommand.id]),
  );
  expect(report).not.toHaveBeenCalled();
});

test.each([
  'insertText',
  'insertParagraph',
  'deleteCompositionText',
  'deleteByCut',
  'historyUndo',
  'historyRedo',
])('leaves unrelated %s input with its native owner', (inputType) => {
  const f = fixture();
  expect(f.input.dispatchEvent(inputEvent(inputType))).toBe(true);
  expect(f.executeCommand).not.toHaveBeenCalled();
});

test('refuses noncancelable, already prevented, composing and foreign events', () => {
  const f = fixture();
  const prevented = inputEvent();
  prevented.preventDefault();
  const foreign = inputEvent();
  // A bubbled descendant/foreign event must not edit this native input's unit.
  Object.defineProperty(foreign, 'target', { value: new EventTarget() });
  for (const event of [
    inputEvent('deleteContentBackward', { cancelable: false }),
    prevented,
    inputEvent('deleteContentBackward', { isComposing: true }),
    foreign,
  ])
    f.input.dispatchEvent(event);
  expect(f.executeCommand).not.toHaveBeenCalled();
});

test.each(['readOnly', 'focused', 'selected', 'composing', 'disposed', 'currentUnitId'] as const)(
  'checks live %s state for every deletion and resumes only when eligible',
  (field) => {
    const f = fixture();
    f.input.dispatchEvent(inputEvent());
    const original = f.state[field];
    if (field === 'currentUnitId') f.state[field] = 'another-doc';
    else f.state[field] = !f.state[field];
    const blocked = inputEvent();
    expect(f.input.dispatchEvent(blocked)).toBe(true);
    expect(blocked.defaultPrevented).toBe(false);
    expect(f.executeCommand).toHaveBeenCalledTimes(1);
    if (field === 'currentUnitId') f.state[field] = original as string;
    else f.state[field] = original as boolean;
    expect(f.input.dispatchEvent(inputEvent())).toBe(false);
    expect(f.executeCommand).toHaveBeenCalledTimes(2);
  },
);

test('refuses a missing current unit and preserves composition until native finalization', () => {
  const f = fixture();
  f.state.currentUnitId = undefined;
  expect(f.input.dispatchEvent(inputEvent())).toBe(true);
  f.state.currentUnitId = 'doc';
  f.state.composing = true;
  // Some composition-end ordering has isComposing=false before the native
  // composition manager has finalized its selection/history. Keep that fence.
  expect(f.input.dispatchEvent(inputEvent())).toBe(true);
  f.state.composing = false;
  expect(f.input.dispatchEvent(inputEvent())).toBe(false);
  expect(f.executeCommand).toHaveBeenCalledExactlyOnceWith(DeleteLeftCommand.id);
});

test('reports unexpected command rejection once without retrying the edit', async () => {
  const f = fixture();
  const error = new Error('Native command failed');
  f.executeCommand.mockRejectedValueOnce(error);
  expect(f.input.dispatchEvent(inputEvent())).toBe(false);
  await Promise.resolve();
  expect(report).toHaveBeenCalledExactlyOnceWith(error);
  expect(f.executeCommand).toHaveBeenCalledTimes(1);
});

test('disposal removes native input/focus listeners and restores the owned input style', () => {
  const f = fixture();
  f.guard.dispose();
  f.state.readOnly = true;
  f.focus.next();
  f.state.readOnly = false;
  expect(f.input.dispatchEvent(inputEvent())).toBe(true);
  expect(f.executeCommand).not.toHaveBeenCalled();
  expect(f.exitMobileEditMode).not.toHaveBeenCalled();
  expect(f.input.style.getPropertyValue('min-height')).toBe('2px');
  expect(f.input.style.getPropertyPriority('min-height')).toBe('important');
});

function shortcuts(f: ReturnType<typeof fixture>) {
  const context = new ContextService();
  context.setContextValue(FOCUSING_DOC, true);
  context.setContextValue(FOCUSING_UNIVER_EDITOR, true);
  const service = new ShortcutService(
    f.commands as unknown as ICommandService,
    { isMac: false, isWindows: false, isLinux: true } as ConstructorParameters<
      typeof ShortcutService
    >[1],
    context,
    { get: () => undefined } as unknown as ConstructorParameters<typeof ShortcutService>[3],
  );
  cleanups.push(
    () => service.dispose(),
    () => context.dispose(),
  );
  f.injector.add([IShortcutService, { useValue: service }]);
  f.injector.add<Pick<IRenderManagerService, 'registerRenderModule'>>([
    IRenderManagerService,
    { useValue: { registerRenderModule: () => ({ dispose() {} }) } },
  ]);
  const plugin = new DocPhoneViewPlugin({}, f.injector);
  plugin.onStarting();
  cleanups.push(() => plugin.dispose());
  return { context, service, plugin };
}

function keyEvent(keyCode: KeyCode, isComposing = false) {
  return Object.assign(new Event('keydown', { cancelable: true }), {
    keyCode,
    isComposing,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  });
}

test.each([
  [KeyCode.BACKSPACE, DeleteLeftCommand.id, 'deleteContentBackward'],
  [KeyCode.DELETE, DeleteRightCommand.id, 'deleteContentForward'],
])(
  'native key %s cancels browser deletion and dispatches one native command',
  (keyCode, id, inputType) => {
    const f = fixture();
    shortcuts(f);
    const event = keyEvent(keyCode);
    const proceed = window.dispatchEvent(event);
    if (proceed) f.input.dispatchEvent(inputEvent(inputType));
    expect(proceed).toBe(false);
    expect(f.executeCommand).toHaveBeenCalledExactlyOnceWith(id, undefined);
  },
);

test('native shortcuts retain focus/composition exclusions and their plugin lifetime', () => {
  const f = fixture();
  const s = shortcuts(f);
  expect(s.service.getAllShortcuts().map(({ id }) => id)).toEqual([
    EnterCommand.id,
    DeleteLeftCommand.id,
    DeleteRightCommand.id,
  ]);
  expect(window.dispatchEvent(keyEvent(KeyCode.BACKSPACE, true))).toBe(true);
  for (const [key, value] of [
    [FOCUSING_DOC, false],
    [FOCUSING_UNIVER_EDITOR, false],
    [FOCUSING_COMMON_DRAWINGS, true],
  ] as const) {
    s.context.setContextValue(key, value);
    expect(window.dispatchEvent(keyEvent(KeyCode.BACKSPACE))).toBe(true);
    s.context.setContextValue(key, !value);
  }
  expect(f.executeCommand).not.toHaveBeenCalled();
  s.plugin.dispose();
  expect(s.service.getAllShortcuts()).toEqual([]);
  expect(window.dispatchEvent(keyEvent(KeyCode.BACKSPACE))).toBe(true);
  expect(f.executeCommand).not.toHaveBeenCalled();
});
