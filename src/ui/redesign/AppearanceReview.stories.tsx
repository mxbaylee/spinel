import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AppearanceReview } from './AppearanceReview.tsx';

const meta = {
  title: 'Redesign/Appearance',
  component: AppearanceReview,
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Post-launch appearance exploration using the existing full-editor chrome and native editors. Local fixture state only. Try Space appearance, Change cover, page navigation, and scrolling past the cover. Uploads stay on this device; Unsplash uses one attributed offline sample.',
      },
    },
  },
} satisfies Meta<typeof AppearanceReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SpaceRuby: Story = { args: { initialAccent: 'ruby' } };
export const SpaceEmerald: Story = { args: { initialAccent: 'emerald' } };
export const SpaceSapphire: Story = { args: { initialAccent: 'sapphire' } };
export const SpaceAmethyst: Story = { args: { initialAccent: 'amethyst' } };
export const DocWithGemBanner: Story = { args: { space: false, initialAccent: 'amethyst' } };
export const SheetWithGemBanner: Story = {
  args: { space: false, kind: 'sheet', initialAccent: 'sapphire' },
};
export const DocWithPhotoBanner: Story = { args: { space: false, initialCover: 'photo' } };
export const SheetWithPhotoBanner: Story = {
  args: { space: false, kind: 'sheet', initialCover: 'photo' },
};
export const DocInSpaceWithBanner: Story = {
  args: { initialAccent: 'emerald', initialCover: 'photo' },
};
export const SheetInSpaceWithBanner: Story = { args: { kind: 'sheet', initialAccent: 'ruby' } };
export const NoCover: Story = { args: { initialCover: 'none' } };
export const SpaceAccentPicker: Story = { args: { initialDialog: 'accent' } };
export const GemPicker: Story = { args: { initialDialog: 'cover' } };
export const UploadPicker: Story = { args: { initialDialog: 'cover', initialSource: 'Upload' } };
export const UnsplashPicker: Story = {
  args: { initialDialog: 'cover', initialSource: 'Unsplash', initialCover: 'photo' },
};

export const ScrolledPastCover: Story = {
  args: { initialCover: 'photo' },
  play: async ({ canvasElement }) => {
    const main = canvasElement.querySelector<HTMLElement>('.rd-main')!;
    main.scrollTop = main.scrollHeight;
    await expect(main.scrollTop).toBeGreaterThan(0);
    const cover = canvasElement.querySelector('.rd-page-cover')!.getBoundingClientRect();
    await expect(cover.bottom).toBeLessThanOrEqual(main.getBoundingClientRect().top + 1);
  },
};

export const SpacePagesDrawer: Story = {
  args: { initialAccent: 'sapphire', initialCover: 'photo' },
  play: async ({ canvasElement }) => {
    if (canvasElement.ownerDocument.defaultView!.innerWidth <= 900) {
      await userEvent.click(
        within(canvasElement).getByRole('button', { name: 'Open Space contents' }),
      );
      await expect(
        within(canvasElement.ownerDocument.body).getByRole('dialog', { name: 'Space contents' }),
      ).toBeVisible();
    }
  },
};

export const IndependentPageCovers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const openPage = async (name: string) => {
      if (!canvas.queryByRole('button', { name })) {
        await userEvent.click(canvas.getByRole('button', { name: 'Open Space contents' }));
      }
      await userEvent.click(body.getByRole('button', { name }));
    };
    await openPage('Budget');
    await expect(canvas.getByRole('button', { name: 'Add cover' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Add cover' }));
    await userEvent.click(body.getByRole('button', { name: 'Unsplash' }));
    await userEvent.click(body.getByRole('button', { name: /Coastal cliffs/ }));
    await userEvent.click(body.getByRole('button', { name: /^Done$/ }));
    await openPage('Overview');
    await expect(canvasElement.querySelector('.rd-page-cover')).toHaveAttribute(
      'data-cover',
      'gem',
    );
    await openPage('Budget');
    await expect(canvasElement.querySelector('.rd-page-cover')).toHaveAttribute(
      'data-cover',
      'photo',
    );
  },
};

export const UploadError: Story = {
  args: { initialDialog: 'cover', initialSource: 'Upload' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.upload(
      body.getByLabelText('Choose an image'),
      new File(['not an image'], 'notes.txt', { type: 'text/plain' }),
      { applyAccept: false },
    );
    await expect(body.getByRole('alert')).toHaveTextContent(
      'Choose a JPG, PNG or WebP image smaller than 8 MB.',
    );
  },
};

export const UnsplashEmpty: Story = {
  args: { initialDialog: 'cover', initialSource: 'Unsplash' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(body.getByLabelText('Search photos'), 'snow');
    await expect(body.getByText('No sample photos match. Try “coast”.')).toBeVisible();
  },
};

// Color changes must leave the independently chosen page cover alone.
export const IndependentAccentAndCover: Story = {
  args: { initialAccent: 'emerald', initialCover: 'photo' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const photo = canvasElement.querySelector('.rd-page-cover > img');
    const source = photo?.getAttribute('src');
    await userEvent.click(canvas.getByRole('button', { name: 'Space appearance' }));
    await userEvent.click(body.getByRole('button', { name: 'Sapphire' }));
    await userEvent.click(body.getByRole('button', { name: /^Done$/ }));
    await expect(canvasElement.querySelector('[data-accent]')).toHaveAttribute(
      'data-accent',
      'sapphire',
    );
    await expect(photo).toHaveAttribute('src', source!);
    await userEvent.click(canvas.getByRole('button', { name: 'Change cover' }));
    await userEvent.click(body.getByRole('button', { name: 'Remove cover' }));
    await userEvent.click(body.getByRole('button', { name: /^Done$/ }));
    await expect(canvas.getByRole('button', { name: 'Add cover' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Add cover' }));
    await userEvent.click(body.getByRole('button', { name: /^Amethyst$/ }));
    await userEvent.click(body.getByRole('button', { name: 'Wide prism' }));
    await userEvent.click(body.getByRole('button', { name: /^Done$/ }));
    await expect(canvasElement.querySelector('.rd-page-cover')).toHaveAttribute(
      'data-cover',
      'gem',
    );
  },
};
