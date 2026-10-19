import type { StorybookConfig } from '@storybook/react-vite';

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
    if (config.build?.rolldownOptions) delete config.build.rolldownOptions.input;
    if (config.build) {
      delete config.build.outDir;
      delete config.build.emptyOutDir;
    }
    config.resolve = { ...config.resolve, dedupe: ['react', 'react-dom'] };
    return config;
  },
};
export default config;
