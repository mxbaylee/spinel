import type { PluginCtor } from '@univerjs/core';
import type { IPreset } from '@univerjs/presets';
import {
  UniverDocsCorePreset,
  UniverDocsUIPlugin,
  UniverDocsMobileUIPlugin,
  UniverUIPlugin,
  UniverMobileUIPlugin,
} from '@univerjs/preset-docs-core';
import type { IUniverDocsCorePresetConfig } from '@univerjs/preset-docs-core';
import {
  UniverDrawingUIPlugin,
  UniverDrawingMobileUIPlugin,
  UniverDocsDrawingUIPlugin,
  UniverDocsDrawingMobileUIPlugin,
} from '@univerjs/preset-docs-drawing';
import {
  UniverDocsHyperLinkUIPlugin,
  UniverDocsHyperLinkMobileUIPlugin,
} from '@univerjs/preset-docs-hyper-link';
import './docMobile.css';
import { DocPhoneViewPlugin } from './docPhoneView.ts';

export function useMobileDocControls() {
  return window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
}

/** Select public mobile plugins before creating a unit, retaining the preset's models. */
export function mobileDocPlugins(preset: IPreset, mobile: boolean): IPreset {
  if (!mobile) return preset;
  const replacements = new Map<PluginCtor, PluginCtor>([
    [UniverUIPlugin, UniverMobileUIPlugin],
    [UniverDocsUIPlugin, UniverDocsMobileUIPlugin],
    [UniverDrawingUIPlugin, UniverDrawingMobileUIPlugin],
    [UniverDocsDrawingUIPlugin, UniverDocsDrawingMobileUIPlugin],
    [UniverDocsHyperLinkUIPlugin, UniverDocsHyperLinkMobileUIPlugin],
  ]);
  return {
    ...preset,
    plugins: preset.plugins.map((entry) => {
      const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined];
      const replacement = replacements.get(plugin);
      return replacement ? [replacement, options] : entry;
    }),
  };
}

export function docPreset(
  container: HTMLElement,
  mobile: boolean,
  readOnly = false,
  menu?: IUniverDocsCorePresetConfig['menu'],
  copyEnabled = false,
): IPreset {
  container.classList.toggle('spinel-mobile-doc', mobile);
  const preset = UniverDocsCorePreset({
    container,
    menu,
    ...(mobile ? { disableAutoFocus: true } : {}),
    // The mobile Edit button is not itself an authorization boundary. Viewers
    // retain the normal permission fence and do not get editing affordances.
    ...(mobile && readOnly ? { header: copyEnabled, footer: false, toolbar: copyEnabled } : {}),
  });
  return mobileDocPlugins(
    {
      ...preset,
      plugins: [
        ...preset.plugins.map((entry): IPreset['plugins'][number] => {
          const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined];
          if (plugin === UniverUIPlugin && mobile && readOnly && copyEnabled)
            return [plugin, { ...options, headerMenu: false }];
          if (plugin !== UniverDocsUIPlugin) return entry;
          return [
            plugin,
            {
              ...options,
              // SDK hints are painted at 50% opacity. Use accessible shell text.
              placeholder: false,
              ...(mobile && readOnly ? { footer: false } : {}),
            },
          ];
        }),
        ...(mobile ? [DocPhoneViewPlugin] : []),
      ],
    },
    mobile,
  );
}
