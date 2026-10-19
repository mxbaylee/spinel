import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
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

const meta = {
  title: 'Settings/ThemeSettings',
  component: ThemeSettings,
} satisfies Meta<typeof ThemeSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The select starts on the theme chosen in the toolbar. */
export const Default: Story = {};
/** The browser refuses to save the choice: the theme still applies for this visit and an alert says why. */
export const StorageBlocked: Story = {
  decorators: [blockStorage],
  play: async ({ canvasElement }) => {
    const select = within(canvasElement).getByRole<HTMLSelectElement>('combobox', {
      name: 'Theme',
    });
    await userEvent.selectOptions(select, select.value);
  },
};
