import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { ImportFile } from './ImportFile.tsx';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import { ARCHIVE_LIMIT } from '../src/shared/archive.ts';

const meta = {
  id: 'dashboard-importfile',
  title: 'Current production/Dashboard/ImportFile',
  component: ImportFile,
  // Dropping a file anywhere in the folder also imports; stories use the picker.
  args: { parentId: null, dropTarget: { current: null }, enabled: true, onImported: () => {} },
} satisfies Meta<typeof ImportFile>;
export default meta;
type Story = StoryObj<typeof meta>;

const pick = async (canvasElement: HTMLElement, ...files: File[]) => {
  const input = within(canvasElement.ownerDocument.body).getByLabelText<HTMLInputElement>(
    'Univer file or archive',
    {
      selector: 'input',
    },
  );
  // The picker takes one file, but a drop can carry several. Let the test send more than one.
  input.multiple = files.length > 1;
  await userEvent.upload(input, files, { applyAccept: false });
};
const snapshot = JSON.stringify({ id: 'sheet-1', sheets: {} });
const univerFile = () => new File([snapshot], 'budget.univer.json', { type: 'application/json' });

export const Default: Story = {};
export const Dialog: Story = {
  args: { dialogOpen: true },
  play: async ({ canvasElement }) =>
    assertDialogControls(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Import file' }),
    ),
};
export const ImportingDialog: Story = {
  args: { dialogOpen: true },
  parameters: { api: { 'POST /api/items/import': pending() } },
  play: async ({ canvasElement }) => {
    await pick(canvasElement, univerFile());
    await assertDialogControls(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Import file' }),
    );
  },
};
/** The limits disclosure is closed by default. */
export const LimitsOpen: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('details')?.setAttribute('open', '');
  },
};
export const UnsupportedFile: Story = {
  play: ({ canvasElement }) => pick(canvasElement, new File(['%PDF'], 'budget.pdf')),
};
export const NotJson: Story = {
  play: ({ canvasElement }) => pick(canvasElement, new File(['not json'], 'budget.json')),
};
export const TooManyFiles: Story = {
  play: ({ canvasElement }) =>
    pick(canvasElement, univerFile(), new File([snapshot], 'trip.univer.json')),
};
/** The picker and button stay disabled while the server reads the file. */
export const Importing: Story = {
  parameters: { api: { 'POST /api/items/import': pending() } },
  play: ({ canvasElement }) => pick(canvasElement, univerFile()),
};
export const ImportFailed: Story = {
  parameters: {
    api: { 'POST /api/items/import': failure('This file is not a Spinel-compatible Univer file.') },
  },
  play: ({ canvasElement }) => pick(canvasElement, univerFile()),
};

const archive = () => new File(['ZIP fixture'], 'my-files.zip', { type: 'application/zip' });

export const ArchiveImporting: Story = {
  args: { dialogOpen: true },
  parameters: { api: { 'POST /api/items/archive-import': pending() } },
  play: async ({ canvasElement }) => {
    await pick(canvasElement, archive());
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.getByRole('status')).toHaveTextContent(/Your files will appear together/);
    await expect(screen.getByRole('button', { name: 'Cancel import' })).toBeEnabled();
    await assertDialogControls(screen.getByRole('dialog', { name: 'Import file' }));
  },
};

export const ArchiveImported: Story = {
  args: { dialogOpen: true, onArchiveImported: fn(), onDialogOpenChange: fn() },
  parameters: {
    api: {
      'POST /api/items/archive-import': { result: { items: 9, files: 5, folders: 3, spaces: 1 } },
    },
  },
  play: async ({ canvasElement, args }) => {
    await pick(canvasElement, archive());
    const screen = within(canvasElement.ownerDocument.body);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Imported 5 files, 3 folders and 1 Space into My files.',
      ),
    );
    await expect(args.onArchiveImported).toHaveBeenCalledOnce();
    await expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    await expect(screen.queryByRole('button', { name: 'Cancel import' })).not.toBeInTheDocument();
    await assertDialogControls(screen.getByRole('dialog', { name: 'Import file' }));
  },
};

export const EmptyArchive: Story = {
  args: { dialogOpen: true },
  parameters: {
    api: {
      'POST /api/items/archive-import': { result: { items: 0, files: 0, folders: 0, spaces: 0 } },
    },
  },
  play: async ({ canvasElement }) => {
    await pick(canvasElement, archive());
    const screen = within(canvasElement.ownerDocument.body);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'This archive was empty. No items were added.',
      ),
    );
  },
};

export const ArchiveFailed: Story = {
  args: { dialogOpen: true, onArchiveImported: fn() },
  parameters: {
    api: {
      'POST /api/items/archive-import': failure('This archive is invalid. No files were added.'),
    },
  },
  play: async ({ canvasElement, args }) => {
    await pick(canvasElement, archive());
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'This archive is invalid. No files were added.',
    );
    await expect(args.onArchiveImported).not.toHaveBeenCalled();
    await expect(screen.getByRole('button', { name: 'Choose another file' })).toBeEnabled();
  },
};

export const ArchiveCancelled: Story = {
  args: { dialogOpen: true, onArchiveImported: fn() },
  parameters: { api: { 'POST /api/items/archive-import': pending() } },
  play: async ({ canvasElement, args }) => {
    await pick(canvasElement, archive());
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await expect(screen.getByRole('status')).toHaveTextContent(
      'Import stopped. Refresh your files to check whether it finished before trying again.',
    );
    await expect(args.onArchiveImported).not.toHaveBeenCalled();
    await expect(screen.getByRole('button', { name: 'Choose another file' })).toBeEnabled();
  },
};

export const ArchiveNeedsMyFiles: Story = {
  args: { parentId: 'owned-folder', dialogOpen: true },
  play: async ({ canvasElement }) => {
    await pick(canvasElement, archive());
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('alert'),
    ).toHaveTextContent('Open My files to import a Spinel ZIP archive.');
  },
};

export const ArchiveTooLarge: Story = {
  args: { dialogOpen: true },
  play: async ({ canvasElement }) => {
    const oversized = archive();
    // Exercise the size guard without allocating an oversized fixture in the browser.
    Object.defineProperty(oversized, 'size', { value: ARCHIVE_LIMIT + 1 });
    await pick(canvasElement, oversized);
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('alert'),
    ).toHaveTextContent('Spinel archives must be at most 8 GiB.');
  },
};

export const ArchiveUnconfirmed: Story = {
  args: { dialogOpen: true, onArchiveImported: fn() },
  play: async ({ canvasElement, args }) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/archive-import')) throw new TypeError('Connection lost');
      return original(input, init);
    };
    try {
      await pick(canvasElement, archive());
      await expect(
        await within(canvasElement.ownerDocument.body).findByRole('alert'),
      ).toHaveTextContent('Could not confirm the import. Refresh your files before trying again.');
      await expect(args.onArchiveImported).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  },
};

export const ArchiveInterruptedByMaintenance: Story = {
  args: { dialogOpen: true, onArchiveImported: fn() },
  play: async ({ canvasElement, args }) => {
    const original = globalThis.fetch;
    // The browser dropped the early reply; the status poll explains the cause.
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/archive-import')) throw new TypeError('Connection lost');
      if (String(input).endsWith('/api/maintenance'))
        return Response.json(
          { available: true, phase: 'paused', epoch: 'fixture-epoch', notice: null },
          { status: 503 },
        );
      return original(input, init);
    };
    try {
      await pick(canvasElement, archive());
      await expect(
        await within(canvasElement.ownerDocument.body).findByRole('alert'),
      ).toHaveTextContent(
        'Workspace maintenance interrupted this import. After the workspace resumes, refresh your files to check whether it finished.',
      );
      await expect(args.onArchiveImported).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  },
};
