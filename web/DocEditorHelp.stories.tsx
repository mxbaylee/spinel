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
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(imageUploadFailed);
  },
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
    uploadError: 'Connect before inserting a new image. Existing images remain available offline.',
  },
};
export const ImageLimit: Story = {
  args: { uploadError: 'This document has reached its 50 MiB image limit.' },
};
export const UnsupportedImage: Story = {
  args: { uploadError: 'This image cannot be pasted. Insert it from a file instead.' },
};
export const ClipboardFailure: Story = {
  args: { uploadError: 'The clipboard content could not be pasted. Try copying it again.' },
};
export const UploadedNotInserted: Story = {
  args: {
    uploadError: 'The image was uploaded but could not be inserted. Try inserting it again.',
  },
};
export const InsertionFailure: Story = {
  args: { uploadError: 'The image could not be inserted. Try inserting it again.' },
};
