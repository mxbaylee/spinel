import { ThemeService } from '@univerjs/core';
import type { Univer, DependencyOverride } from '@univerjs/core';
import { ICanvasColorService } from '@univerjs/engine-render';
import { defaultTheme } from '@univerjs/presets';
import { getTheme, watchTheme } from './theme.ts';
import { palettes, editorNeutrals } from './palette.ts';
export function editorTheme() {
  const colors = palettes[getTheme()];
  return {
    ...defaultTheme,
    gray: editorNeutrals,
    primary: {
      ...defaultTheme.primary,
      50: colors['sp-tint-1'],
      100: colors['sp-tint-1'],
      200: colors['sp-border'],
      400: colors['sp-accent-2'],
      500: colors['sp-accent'],
      // Primary buttons retain white-text contrast in both modes.
      600: '#c42c58',
      700: '#a61e49',
      800: '#8a1d3f',
      900: '#4a1e33',
    },
  };
}
export function bindEditorTheme(univer: Univer, redraw?: () => void) {
  const service = univer.__getInjector().get(ThemeService);
  const update = () => {
    service.setTheme(editorTheme());
    service.setDarkMode(getTheme() === 'dark');
    redraw?.();
  };
  update();
  return watchTheme(update);
}

// Document literals must stay exact: preset pairs are already mapped by our
// display interceptor. SDK theme tokens still follow the editor chrome.
export function canvasColorOverride(): DependencyOverride[number] {
  return [
    ICanvasColorService,
    {
      useFactory: (theme: ThemeService) => ({
        getRenderColor: (color: string) =>
          theme.isValidThemeColor(color) ? theme.getColorFromTheme<string>(color) : color,
      }),
      deps: [ThemeService],
    },
  ];
}
