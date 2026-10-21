import type { Decorator, Preview } from '@storybook/react-vite';
import '../src/ui/theme.css';
import { initializeTheme, setPreference } from '../src/ui/theme.ts';
import type { ThemeMode } from '../src/ui/palette.ts';
import { mockFetch } from './api.ts';
import type { ApiMock } from './api.ts';

// Match the app's OS-theme listener so the System segment remains live.
if (typeof window !== 'undefined') initializeTheme();

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
  // Stories fill the canvas until a viewport is picked from the toolbar. A story
  // that needs one sets `globals: { viewport: { value: 'phone', isRotated: false } }`.
  initialGlobals: { theme: 'light', viewport: { value: undefined, isRotated: false } },
  parameters: {
    layout: 'fullscreen',
    options: { storySort: { order: ['Redesign', 'Identity', 'Current production', '*'] } },
    controls: { expanded: true },
    // theme.css switches the rail to a top bar at 640px and stacks the dashboard at 600px.
    viewport: {
      options: {
        phone: { name: 'Phone', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' }, type: 'tablet' },
        desktop: { name: 'Desktop', styles: { width: '1280px', height: '800px' }, type: 'desktop' },
      },
    },
  },
};
export default preview;
