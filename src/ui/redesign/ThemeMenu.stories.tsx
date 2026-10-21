import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { getPreference, setPreference } from '../theme.ts';
import { ThemeMenu } from './Mockups.tsx';

/** Exercise the real theme store while only localStorage writes are blocked. */
function BlockedStorage({ children }: { children: ReactNode }) {
  useEffect(() => {
    const original = Storage.prototype.setItem;
    const preference = getPreference();
    let saved: string | null = null;
    let readable = false;
    try {
      saved = localStorage.getItem('spinel-theme');
      readable = true;
    } catch {
      // A naturally unavailable store has no value to restore.
    }
    Storage.prototype.setItem = function (this: Storage, ...args: Parameters<Storage['setItem']>) {
      if (this === localStorage)
        throw new DOMException('Storage is blocked.', 'QuotaExceededError');
      return original.apply(this, args);
    };
    return () => {
      Storage.prototype.setItem = original;
      setPreference(preference);
      if (readable) {
        try {
          if (saved === null) localStorage.removeItem('spinel-theme');
          else localStorage.setItem('spinel-theme', saved);
        } catch {
          // Restore the method even if the browser itself still blocks storage.
        }
      }
    };
  }, []);
  return children;
}
const meta = {
  title: 'Redesign/Theme control',
  component: ThemeMenu,
  decorators: [
    (Story) => (
      <div className="sp-ui" style={{ maxWidth: 360, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ThemeMenu>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const StorageBlocked: Story = {
  decorators: [
    (Story) => (
      <BlockedStorage>
        <Story />
      </BlockedStorage>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const previous = getPreference();
    const saved = localStorage.getItem('spinel-theme');
    const next = previous === 'dark' ? 'light' : 'dark';
    await userEvent.click(canvas.getByRole('radio', { name: next === 'light' ? 'Light' : 'Dark' }));
    await expect(getPreference()).toBe(next);
    await expect(document.documentElement.dataset.theme).toBe(next);
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Theme changed for this visit. Your preference could not be saved.',
    );
    await expect(localStorage.getItem('spinel-theme')).toBe(saved);
    // Restore the capture's requested theme while retaining the visible save failure.
    await userEvent.click(
      canvas.getByRole('radio', {
        name: previous === 'system' ? 'Follow system' : previous === 'light' ? 'Light' : 'Dark',
      }),
    );
    await expect(getPreference()).toBe(previous);
    await expect(localStorage.getItem('spinel-theme')).toBe(saved);
  },
};
