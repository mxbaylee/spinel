import { CommandService, CommandType } from '@univerjs/core';
import type { ICommandService } from '@univerjs/core';

const registrations = new WeakMap<ICommandService, Set<string>>();
let recording = false;

/** Evidence builds observe public registrations before the real presets start. */
export function recordNativeMutationInventory() {
  if (import.meta.env.VITE_SYNC_EVIDENCE !== '1' || recording) return;
  recording = true;
  for (const method of ['registerCommand', 'registerMultipleCommand'] as const) {
    const register = CommandService.prototype[method];
    CommandService.prototype[method] = function (command) {
      const handle = register.call(this, command);
      if (command.type === CommandType.MUTATION) {
        let ids = registrations.get(this);
        if (!ids) registrations.set(this, (ids = new Set()));
        ids.add(command.id);
      }
      return handle;
    };
  }
}

/** Read-only IDs, including mutation-typed operations; no editor or params escape. */
export function nativeMutationInventory(commands: ICommandService): string[] {
  return [...(registrations.get(commands) ?? [])].sort();
}
