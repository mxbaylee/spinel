import { expect, test } from 'vitest';
import { Univer, ThemeService } from '@univerjs/core';
import {
  CanvasColorService,
  ICanvasColorService,
  UniverRenderEnginePlugin,
} from '@univerjs/engine-render';
import { editorTheme, installCanvasColors } from './editorTheme.ts';
import { fillPresets } from './palette.ts';
import { displayPresetCell, presetCellForEditing, presetStyle } from './presetStyles.ts';

test('native dark rendering changes paper, text and custom colors without changing saved styles', () => {
  const univer = new Univer({ theme: editorTheme('light') });
  try {
    univer.registerPlugin(UniverRenderEnginePlugin);
    installCanvasColors(univer);
    const injector = univer.__getInjector();
    const service = injector.get(ICanvasColorService);
    const theme = injector.get(ThemeService);
    const native = new CanvasColorService(theme);
    try {
      for (const mode of ['light', 'dark', 'light'] as const) {
        theme.setTheme(editorTheme(mode));
        theme.setDarkMode(mode === 'dark');
        for (const color of ['#ffffff', '#000000', '#123456', '#ffb547', 'gray.900', 'transparent'])
          expect(service.getRenderColor(color), `${mode}: ${color}`).toBe(
            native.getRenderColor(color),
          );
        if (mode === 'dark') {
          expect(service.getRenderColor('#ffffff')).not.toBe('#ffffff');
          expect(service.getRenderColor('#000000')).not.toBe('#000000');
        }
        for (const { id } of fillPresets) {
          const style = { ...presetStyle(id, 'light'), bl: 1, fs: 16 };
          const stored = { s: style, v: 24, f: '=12*2' };
          const serialized = JSON.stringify(stored);
          const display = displayPresetCell(stored, style);
          const expected = presetStyle(id, mode);
          expect(service.getRenderColor(display.interceptorStyle!.bg!.rgb!)).toBe(expected.bg!.rgb);
          expect(service.getRenderColor(display.interceptorStyle!.cl!.rgb!)).toBe(expected.cl!.rgb);
          expect(presetCellForEditing(display, stored, style).interceptorStyle).toEqual(style);
          // Serialization/export and the canonical editing model never receive render tokens.
          expect(JSON.stringify(stored)).toBe(serialized);
          expect(display.s).toBe(style);
        }
      }
      theme.setTheme({
        ...editorTheme('light'),
        gray: { ...editorTheme('light').gray, 900: '#123456' },
      });
      expect(service.getRenderColor('gray.900')).toBe('#123456');
    } finally {
      native.dispose();
    }
  } finally {
    univer.dispose();
  }
});
