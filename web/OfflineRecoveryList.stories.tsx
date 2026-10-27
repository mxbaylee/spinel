import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { OfflineDownload } from './offline/offlineStore.ts';
import { OfflineRecoveryList } from './OfflineRecoveryEntry.tsx';

const id = (value: number) => value.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000054';
const copy = (
  value: number,
  name: string,
  pending: boolean,
  spaceId?: string,
): OfflineDownload => ({
  itemId: id(value),
  name,
  kind: spaceId ? 'sheet' : 'doc',
  ...(spaceId ? { spaceId } : {}),
  pending,
  readOnly: false,
  revision: 7,
  downloadedAt: Date.UTC(2026, 9, 27, 14, 35),
});
const ordinary = copy(1, 'Autumn travel plans', true);
const child = copy(2, 'Workshop budget', true, id(10));
const clean = copy(3, 'Saved research notes', false);

const meta = {
  id: 'offline-recovery-list',
  title: 'Current production/Offline/Recovery list',
  component: OfflineRecoveryList,
  args: {
    downloads: [child, clean, ordinary],
    navigation: { allow: fn(() => false), dirty: fn() },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The production My files list uses account-scoped download summaries. Native reconstruction and recovery are exercised by the browser acceptance suite.',
      },
    },
  },
} satisfies Meta<typeof OfflineRecoveryList>;
export default meta;
type Story = StoryObj<typeof meta>;

const checkCopies: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const section = within(canvas.getByRole('region', { name: 'Offline changes on this device' }));
  const links = section.getAllByRole('link');
  await expect(links).toHaveLength(2);
  await expect(links.map((link) => link.textContent)).toEqual([
    `Recover ${ordinary.name}`,
    `Recover ${child.name}`,
  ]);
  await expect(links[0]).toHaveAttribute('href', `/?offlineRecovery=${ordinary.itemId}`);
  // The recovery link remains an account entry even for a pending Space child.
  await expect(links[1]).toHaveAttribute('href', `/?offlineRecovery=${child.itemId}`);
  await expect(canvas.queryByText(clean.name, { exact: false })).not.toBeInTheDocument();
};

export const PendingOrdinaryAndSpace: Story = { play: checkCopies };
export const Dark: Story = { ...PendingOrdinaryAndSpace, globals: { theme: 'dark' } };
export const CleanDownloads: Story = {
  args: { downloads: [clean] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole('region', { name: 'Offline changes on this device' }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
  },
};
export const NavigationGuard: Story = {
  play: async (context) => {
    await checkCopies(context);
    const before = location.href;
    await userEvent.click(
      within(context.canvasElement).getByRole('link', { name: `Recover ${child.name}` }),
    );
    await expect(context.args.navigation.allow).toHaveBeenCalledOnce();
    await expect(context.args.navigation.dirty).not.toHaveBeenCalled();
    await expect(location.href).toBe(before);
  },
};
export const LongTitlePhone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  args: {
    downloads: [
      ordinary,
      copy(
        4,
        'Workshop planning — travel, accessibility, accommodation and shared research notes for the October gathering',
        true,
        id(10),
      ),
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const downloads = [...args.downloads];
    for (const download of downloads) {
      const link = canvas.getByRole('link', { name: `Recover ${download.name}` });
      await expect(link).toHaveAttribute('href', `/?offlineRecovery=${download.itemId}`);
      await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    );
  },
};
