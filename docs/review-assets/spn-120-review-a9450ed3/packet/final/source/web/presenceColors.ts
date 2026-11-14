import type { PresenceRenderColors } from '@spinel/presence-ui';
import { validColor } from '../src/profile/profile.ts';
import { presenceFallbackColors } from '../src/ui/palette.ts';

/** Keep canvas identity colors aligned with DOM labels; tokens are never persisted. */
export function presenceRenderColors(
  color: string | undefined,
  selection: 'local' | 'remote',
): PresenceRenderColors | undefined {
  const fallback = presenceFallbackColors.indexOf(color ?? '');
  const token = validColor(color)
    ? `spinel-${color}`
    : fallback >= 0
      ? `spinel-presence-${fallback}`
      : undefined;
  if (!token) return;
  return {
    stroke: `${token}.0`,
    fill: `${token}.${selection === 'local' ? 3 : 2}`,
  };
}
