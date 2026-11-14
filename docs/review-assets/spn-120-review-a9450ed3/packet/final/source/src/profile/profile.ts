import catalog from './person-icon-catalog.json' with { type: 'json' };
import { fillPresets } from '../ui/palette.ts';

export interface Profile {
  name: string;
  icon: string;
  color: string;
}
const names = new Set(catalog.icons.map((icon) => 'lucide:' + icon.name));
export const validIcon = (value: unknown): value is string =>
  typeof value === 'string' && names.has(value);
export const validColor = (value: unknown): value is string =>
  typeof value === 'string' && fillPresets.some((preset) => preset.id === value);
export function defaultProfile(name: string): Profile {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return { name, icon: 'lucide:user-round', color: fillPresets[hash % fillPresets.length].id };
}
/** Public avatar URL contains only a catalog icon and palette key, never a user ID. */
export function profileAvatar(profile: Pick<Profile, 'icon' | 'color'>) {
  return `/profile-avatar/${profile.icon.slice(7)}/${profile.color}.svg`;
}
export function avatarProfile(
  avatar: string | undefined,
): Pick<Profile, 'icon' | 'color'> | undefined {
  const match = /^\/profile-avatar\/([a-z0-9-]+)\/([a-z-]+)\.svg$/.exec(avatar ?? '');
  if (!match || !validIcon('lucide:' + match[1]) || !validColor(match[2])) return;
  return { icon: 'lucide:' + match[1], color: match[2] };
}
