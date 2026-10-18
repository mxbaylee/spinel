import { describe, expect, it } from 'vitest';
import { fillPresets, palettes } from './palette.ts';
import { displayPresetStyle, presetStyle } from './presetStyles.ts';

function luminance(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
describe('Spinel theme', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} text and all sixteen fill presets meet AA`, () => {
      expect(fillPresets).toHaveLength(16);
      const pairs = [
        ['sp-text', 'sp-bg'],
        ['sp-muted', 'sp-bg'],
        ['sp-text', 'sp-panel'],
        ['sp-muted', 'sp-panel'],
        ['sp-on-accent', 'sp-accent'],
        ['sp-rail-ink', 'sp-rail'],
        ['sp-accent', 'sp-bg'],
        ['sp-accent-2', 'sp-bg'],
        ...fillPresets.map(({ id }) => [`fill-${id}-fg`, `fill-${id}-bg`]),
      ];
      for (const [fg, bg] of pairs) {
        const [low, high] = [luminance(palettes[mode][fg]), luminance(palettes[mode][bg])].sort(
          (a, b) => a - b,
        );
        expect((high + 0.05) / (low + 0.05), `${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${mode} adapts every canonical pair without mutating saved formatting`, () => {
      for (const { id } of fillPresets) {
        const original = { ...presetStyle(id, 'light'), bl: 1, fs: 16 };
        const before = structuredClone(original);
        const display = displayPresetStyle(original, mode);
        expect(display).toEqual({ ...before, ...presetStyle(id, mode) });
        expect(display).not.toBe(original);
        expect(original).toEqual(before);
        // A user's custom colour pair stays fixed, per decision #66.
        const custom = { ...original, cl: { rgb: '#123456' } };
        expect(displayPresetStyle(custom, mode)).toBe(custom);
      }
      const plain = { bl: 1 };
      expect(displayPresetStyle(plain, mode)).toBe(plain);
      expect(() => presetStyle('missing', mode)).toThrow('Unknown fill preset');
    });
  }
});
