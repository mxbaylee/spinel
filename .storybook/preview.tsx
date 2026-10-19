import type { Decorator, Preview } from '@storybook/react-vite';
import '../src/ui/theme.css';
import { setPreference } from '../src/ui/theme.ts';
import type { ThemeMode } from '../src/ui/palette.ts';
import { mockFetch } from './api.ts';
import type { ApiMock } from './api.ts';

// Every story renders in the real theme tokens. Switch Vintage (light) and
// Modern (dark) from the toolbar; the shell wrapper matches the app's <main>.
const withShell: Decorator = (Story, context) => {
  setPreference(context.globals.theme as ThemeMode);
  globalThis.fetch = mockFetch(context.parameters.api as ApiMock | undefined);
  if (context.parameters.shell === 'none') return <Story />;
  return (
    <div className="workspace">
      <div className="workspace-body">
        <main style={{ paddingTop: 0 }}>
          <Story />
        </main>
      </div>
    </div>
  );
};

const preview: Preview = {
  decorators: [withShell],
  globalTypes: {
    theme: {
      description: 'Spinel theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Vintage · Light' },
          { value: 'dark', title: 'Modern · Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
};
export default preview;
