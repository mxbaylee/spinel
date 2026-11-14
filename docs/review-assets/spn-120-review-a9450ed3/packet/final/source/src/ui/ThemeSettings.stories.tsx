import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { setPreference } from './theme.ts';
import type { ThemeMode } from './palette.ts';
import { ThemeSettings } from './ThemeSettings.tsx';

// While mounted, saving to localStorage throws, as in a private window or a
// browser with site data blocked. Other storage is left alone.
function BlockedStorage({ children }: { children: ReactNode }) {
  useEffect(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, ...args: Parameters<Storage['setItem']>) {
      if (this === localStorage)
        throw new DOMException('Storage is blocked.', 'QuotaExceededError');
      return original.apply(this, args);
    };
    return () => {
      Storage.prototype.setItem = original;
    };
  }, []);
  return <>{children}</>;
}
const blockStorage: Decorator = (Story) => (
  <BlockedStorage>
    <Story />
  </BlockedStorage>
);

// ThemeSettings shows the in-memory preference from theme.ts, which the preview
// sets to the toolbar theme on every render. Switch it to "system" after that, as
// a saved "Follow system" choice would, and put back the toolbar theme and the
// saved value when the story unmounts.
function FollowingSystem({ toolbar, children }: { toolbar: ThemeMode; children: ReactNode }) {
  const restore = useRef<{ theme: ThemeMode; saved: string | null } | undefined>(undefined);
  if (!restore.current) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('spinel-theme');
    } catch {
      /* Storage is unavailable; there is nothing to put back. */
    }
    restore.current = { theme: toolbar, saved };
  }
  restore.current.theme = toolbar;
  // During render, so ThemeSettings reads it on its first render too.
  setPreference('system');
  useEffect(() => {
    setPreference('system');
    return () => {
      const { theme, saved } = restore.current!;
      setPreference(theme);
      try {
        if (saved === null) localStorage.removeItem('spinel-theme');
        else localStorage.setItem('spinel-theme', saved);
      } catch {
        /* Storage is unavailable; there is nothing to put back. */
      }
    };
  }, []);
  return <>{children}</>;
}
const followSystem: Decorator = (Story, context) => (
  <FollowingSystem toolbar={context.globals.theme as ThemeMode}>
    <Story />
  </FollowingSystem>
);

const meta = {
  id: 'settings-themesettings',
  title: 'Current production/Settings/ThemeSettings',
  component: ThemeSettings,
} satisfies Meta<typeof ThemeSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The segments start on the theme chosen in the toolbar. */
export const Default: Story = {};
/**
 * "Follow system" is selected, so the page takes the operating system's light or
 * dark setting and ignores the toolbar theme.
 */
export const FollowSystem: Story = { decorators: [followSystem] };
/** The browser refuses to save the choice: the theme still applies for this visit and an alert says why. */
export const StorageBlocked: Story = {
  decorators: [blockStorage],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selected = canvas.getByRole('radio', { checked: true });
    await userEvent.click(
      canvas.getByRole('radio', {
        name: selected.getAttribute('aria-label') === 'Dark' ? 'Light' : 'Dark',
      }),
    );
  },
};
