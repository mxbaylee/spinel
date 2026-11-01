import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SheetImageStatus } from './SheetImageStatus.tsx';
import './editorFrame.css';

const meta = {
  id: 'sheet-image-status',
  title: 'Current production/Editor/Sheet images',
  component: SheetImageStatus,
  decorators: [
    (Story) => (
      <div className="editor-frame">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SheetImageStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const FileLimit: Story = {
  args: { error: 'Choose an image no larger than 5 MiB.' },
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole('alert');
    await expect(alert).toHaveTextContent('Choose an image no larger than 5 MiB.');
    await expect(alert.getBoundingClientRect().height).toBe(44);
  },
};
export const PixelLimit: Story = {
  args: { error: 'Choose a valid static PNG, JPEG or WebP image up to 16 megapixels.' },
};
export const DocumentLimit: Story = {
  args: {
    error:
      'This image would exceed this document’s 50 MiB image limit. Choose a smaller image or add it to another document.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Image not inserted · Details' });
    const bounds = canvasElement
      .querySelector('.sheet-image-help')!
      .getBoundingClientRect()
      .toJSON();
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const body = within(document.body);
    await expect(
      await body.findByText(/Choose a smaller image or add it to another document\./, {
        selector: 'p',
      }),
    ).toBeVisible();
    await expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(await body.findByRole('button', { name: 'Close', exact: true }));
    await expect(trigger).toHaveFocus();
    await expect(
      canvasElement.querySelector('.sheet-image-help')!.getBoundingClientRect().toJSON(),
    ).toEqual(bounds);
  },
};
export const Offline: Story = { args: { error: 'Connect before inserting a new image.' } };
export const ChangedSelection: Story = {
  args: { error: 'The selected cell changed. Select a cell and insert the image again.' },
};
export const AccessEnded: Story = {
  args: { error: 'Image insertion needs an account with edit access.' },
};
