import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { DocEditorHelp } from './DocEditorHelp.tsx';
import { imageUploadFailed } from './docImages.ts';
import './editorFrame.css';

const meta = {
  id: 'editor-dochelp',
  title: 'Current production/Editor/Doc feedback',
  component: DocEditorHelp,
  args: { editable: true },
  render: (args) => (
    <section className="editor-frame" style={{ height: 'auto' }}>
      <DocEditorHelp {...args} />
    </section>
  ),
  play: async ({ canvasElement, args }) => {
    if (!args.uploadError) return;
    const alert = within(canvasElement).getByRole('alert');
    await expect(alert).toHaveTextContent(args.uploadError);
    await expect(alert.scrollWidth).toBeLessThanOrEqual(alert.clientWidth);
    await expect(alert.scrollHeight).toBeLessThanOrEqual(alert.clientHeight);
  },
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'The production Doc feedback paragraph. State fixtures verify actionable copy and wrapping; the real native clipboard, save and navigation journey runs in the Doc browser suite.',
      },
    },
  },
} satisfies Meta<typeof DocEditorHelp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Editing: Story = {};
export const PhoneEditing: Story = { args: { mobile: true } };
export const ViewOnly: Story = { args: { editable: false } };
export const PhonePageLayout: Story = { args: { phoneReadOnly: true } };
export const PageLayoutChanged: Story = { args: { phoneLayoutChanged: true } };
export const FormulaFailure: Story = {
  args: { formulaError: 'The formula could not be inserted.' },
};
export const UploadFailed: Story = {
  args: { uploadError: imageUploadFailed },
};
export const SignInEnded: Story = {
  args: { uploadError: 'Your sign-in ended. Sign in again to add an image.' },
};
export const AccessDenied: Story = {
  args: {
    uploadError: 'Image not added. Check your edit access.',
  },
};
export const PreparedOffline: Story = {
  args: {
    uploadError: 'Connect before inserting a new image.',
  },
};
export const ImageLimit: Story = {
  args: { uploadError: 'Doc image limit reached. Try a smaller image.' },
};
export const UnsupportedImage: Story = {
  args: { uploadError: 'This image cannot be pasted. Insert it from a file instead.' },
};
export const ClipboardFailure: Story = {
  args: { uploadError: 'Could not paste. Copy the content and try again.' },
};
export const InsertionFailure: Story = {
  args: { uploadError: 'Image not inserted. Place the cursor and try again.' },
};

export const FileSize: Story = { args: { uploadError: 'Choose an image no larger than 5 MiB.' } };
export const ImageFormat: Story = { args: { uploadError: 'Choose a PNG, JPEG or WebP image.' } };
export const InvalidImage: Story = {
  args: { uploadError: 'Use a static PNG, JPEG or WebP up to 16 megapixels.' },
};
export const ProcessedSize: Story = {
  args: { uploadError: 'Image exceeds 5 MiB. Choose a smaller image.' },
};
export const UploadBusy: Story = {
  args: { uploadError: 'Images are still uploading. Try again shortly.' },
};
