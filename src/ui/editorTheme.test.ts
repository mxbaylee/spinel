import { expect, test } from 'vitest';
import { Univer, ThemeService } from '@univerjs/core';
import { ICanvasColorService, UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { defaultTheme } from '@univerjs/presets';
import { installCanvasColors } from './editorTheme.ts';

test('the registered render service preserves document literals and resolves changing theme tokens', () => {
  const univer = new Univer({ theme: defaultTheme });
  try {
    univer.registerPlugin(UniverRenderEnginePlugin);
    installCanvasColors(univer);
    const injector = univer.__getInjector();
    const service = injector.get(ICanvasColorService);
    const theme = injector.get(ThemeService);
    for (const dark of [false, true]) {
      theme.setDarkMode(dark);
      // Literal preset colours are already adapted by our display interceptor.
      expect(service.getRenderColor('#ffb547')).toBe('#ffb547');
      expect(service.getRenderColor('#123456')).toBe('#123456');
      expect(service.getRenderColor('primary.500')).toBe(defaultTheme.primary[500]);
    }
    theme.setTheme({ ...defaultTheme, primary: { ...defaultTheme.primary, 500: '#ff2a85' } });
    expect(service.getRenderColor('primary.500')).toBe('#ff2a85');
  } finally {
    univer.dispose();
  }
});
