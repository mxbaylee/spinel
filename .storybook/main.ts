import type { StorybookConfig } from '@storybook/react-vite';
import { socialCardExamples } from './socialCards.ts';

// The component catalogue for docs/design/. Stories live beside their
// components in src/ui/ and web/; see docs/design/README.md.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/ui/**/*.stories.tsx', '../web/**/*.stories.tsx'],
  core: { disableTelemetry: true },
  async viteFinal(config) {
    // The app's Vite config roots at web/ and builds the service worker as a
    // second entry. Storybook supplies its own root and entry points.
    delete config.root;
    // Storybook has already set outDir and emptyOutDir: false, which keeps the
    // manager it built first; resetting them lets Vite empty the output folder.
    if (config.build?.rolldownOptions) delete config.build.rolldownOptions.input;
    config.resolve = { ...config.resolve, dedupe: ['react', 'react-dom'] };
    config.define = {
      ...config.define,
      __SPINEL_SOCIAL_CARDS__: JSON.stringify(await socialCardExamples()),
    };
    return config;
  },
};
export default config;
