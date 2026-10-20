import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import sharp from 'sharp';
import { EntityIcon } from './EntityIcon.tsx';
import { entityIconPaths, entityIconSvg } from './entityIconGeometry.ts';
import { palettes } from './palette.ts';

test('adjacent artwork is decorative and standalone artwork has an escaped accessible name', () => {
  const decorative = renderToStaticMarkup(createElement(EntityIcon, { kind: 'doc' }));
  expect(decorative).toContain('aria-hidden="true"');
  expect(decorative).not.toContain('role="img"');
  const meaningful = renderToStaticMarkup(
    createElement(EntityIcon, { kind: 'sheet', label: 'Sheet <budget>' }),
  );
  expect(meaningful).toContain('role="img"');
  expect(meaningful).toContain('aria-label="Sheet &lt;budget&gt;"');
  expect(meaningful).not.toContain('aria-hidden');
  expect(meaningful).toContain('focusable="false"');
});

test('all artwork tokens resolve in both themes and SVG exports remain self-contained', async () => {
  for (const mode of ['light', 'dark'] as const)
    for (const kind of ['doc', 'sheet', 'space'] as const) {
      for (const path of entityIconPaths(kind))
        for (const token of [path.fill, path.stroke]) {
          if (token && token !== 'none') expect(palettes[mode][token]).toMatch(/^#[0-9a-f]{6}$/);
        }
      const svg = entityIconSvg(kind, 32, mode);
      expect(svg).not.toMatch(/<script|<image|href=|url\(|var\(|undefined/);
      expect(svg).toContain('viewBox="0 0 24 24"');
      const { data, info } = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 32, height: 32, channels: 4 });
      // Padding keeps the silhouette inside its canvas, even at the smallest UI scale.
      for (let i = 0; i < 32; i++) {
        for (const pixel of [i, 31 * 32 + i, i * 32, i * 32 + 31])
          expect(data[pixel * 4 + 3]).toBe(0);
      }
    }
});

test('interior marks remain distinct without hue or facet shading', async () => {
  // The owner selected a shared silhouette; interior marks and adjacent labels identify type (#122).
  const icons = await Promise.all(
    (['doc', 'sheet', 'space'] as const).map((kind) =>
      sharp(Buffer.from(entityIconSvg(kind, 24, 'light', true)))
        .raw()
        .toBuffer(),
    ),
  );
  expect(icons[0].equals(icons[1])).toBe(false);
  expect(icons[1].equals(icons[2])).toBe(false);
  expect(icons[0].equals(icons[2])).toBe(false);
  for (const kind of ['doc', 'sheet', 'space'] as const) {
    const tokens = new Set(
      entityIconPaths(kind, true)
        .flatMap((path) => [path.fill, path.stroke])
        .filter(Boolean),
    );
    expect([...tokens].sort()).toEqual(['none', 'sp-panel', 'sp-text']);
  }
});
