import { validIcon, validColor } from '../profile/profile.ts';
import { spaceAccentPalettes } from '../ui/palette.ts';
import { validEmoji } from './emoji.ts';
export const gemNames = Object.keys(spaceAccentPalettes) as GemName[];
export type GemName = keyof typeof spaceAccentPalettes;
export type CoverVariants<T> =
  { shared: T; light?: never; dark?: never } | { shared?: never; light: T; dark: T };
export type UnsplashPhoto = {
  id: string;
  url: string;
  photographer: string;
  profile: string;
  page: string;
};
export type PageCover =
  | { source: 'gem'; gem: GemName }
  | { source: 'upload'; images: CoverVariants<string>; position: number }
  | { source: 'unsplash'; images: CoverVariants<UnsplashPhoto>; position: number };
export interface ItemAppearance {
  revision: number;
  icon: string | null;
  folderColor: string | null;
  accent: GemName | null;
  cover: PageCover | null;
}
export const emptyAppearance = (): ItemAppearance => ({
  revision: 0,
  icon: null,
  folderColor: null,
  accent: null,
  cover: null,
});
export function filenameEmoji(name: string) {
  const choices = ['🌿', '🌻', '🍂', '🍋', '🪻', '🌷', '🪴', '🍄', '🌵', '🍀', '🌺', '🪷'];
  let hash = 0;
  for (const character of name.normalize('NFC'))
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return choices[hash % choices.length];
}
export function validIdentityIcon(value: unknown): value is string {
  return validIcon(value) || validEmoji(value);
}
export { validColor };
export const validGem = (value: unknown): value is GemName =>
  typeof value === 'string' && Object.hasOwn(spaceAccentPalettes, value);
export function coverVariant<T>(images: CoverVariants<T>, mode: 'light' | 'dark'): T {
  return images.shared ?? images[mode]!;
}
export function appearancePath(id: string, spaceId?: string, guest = false) {
  return `/api/appearance/${guest ? 'guest/' : ''}${spaceId ? `spaces/${spaceId}/items/${id}` : `items/${id}`}`;
}
/** Linear character scan: repeated four-character groups can exhaust regexp stacks on images. */
export function validImageBase64(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= Math.ceil(maxBytes / 3) * 4 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  );
}
