import { ThemeService } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import { CanvasColorService, ICanvasColorService } from '@univerjs/engine-render';
import { defaultTheme } from '@univerjs/presets';
import { getTheme, watchTheme } from './theme.ts';
import { palettes, editorNeutrals, fillPresets, presenceFallbackColors } from './palette.ts';
import type { ThemeMode } from './palette.ts';
export function editorTheme(mode: ThemeMode = getTheme()) {
  const colors = palettes[mode];
  return {
    ...defaultTheme,
    gray: editorNeutrals,
    // These tokens exist only on render models and presence controls, never saved styles.
    ...Object.fromEntries(
      fillPresets.map(({ id }) => [
        `spinel-${id}`,
        {
          0: colors[`fill-${id}-bg`],
          1: colors[`fill-${id}-fg`],
          2: colors[`fill-${id}-bg`] + '28',
          3: colors[`fill-${id}-bg`] + '18',
        },
      ]),
    ),
    ...Object.fromEntries(
      presenceFallbackColors.map((color, index) => [
        `spinel-presence-${index}`,
        { 0: color, 2: color + '28', 3: color + '18' },
      ]),
    ),
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

class SpinelCanvasColorService extends CanvasColorService {
  private readonly theme: ThemeService;
  constructor(theme: ThemeService) {
    super(theme);
    this.theme = theme;
  }

  override getRenderColor(color: string): string {
    // Preset pairs already provide their own accessible light/dark mapping.
    // All ordinary document colors and SDK tokens use native dark rendering.
    const preset = color.startsWith('spinel-')
      ? this.theme.getColorFromTheme<unknown>(color)
      : undefined;
    return typeof preset === 'string' ? preset : super.getRenderColor(color);
  }
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

// Install after plugins register and before loading a unit/canvas. The top-level
// createUniver override only handles core services, not render-plugin services.
export function installCanvasColors(univer: Univer) {
  univer.__getInjector().replace([
    ICanvasColorService,
    {
      useFactory: (theme: ThemeService) => new SpinelCanvasColorService(theme),
      deps: [ThemeService],
    },
  ]);
}
