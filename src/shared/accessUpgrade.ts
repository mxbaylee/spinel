import type { ItemAccess } from './workspace.ts';

const strength: Record<ItemAccess, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** Only a current server-authorized increase may keep an existing account editor open. */
export function isAccessUpgrade(before: ItemAccess, after: unknown): after is ItemAccess {
  return (
    typeof after === 'string' &&
    Object.hasOwn(strength, after) &&
    strength[after as ItemAccess] > strength[before]
  );
}
