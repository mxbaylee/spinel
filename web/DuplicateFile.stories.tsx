import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import { DuplicateFile } from './DuplicateFile.tsx';
import type { WorkspaceItem } from '../src/shared/workspace.ts';

const source = {
  id: 'source',
  name: 'Monthly budget',
  kind: 'sheet' as const,
  access: 'owner' as const,
  parentId: 'budgets',
};
const folder = (id: string, name: string, parentId: string | null = null, access = 'owner') => ({
  id,
  name,
  parentId,
  access,
  kind: 'folder',
  createdAt: 1,
  updatedAt: 1,
  tags: [],
});
const items = [
  folder('personal', 'Personal'),
  folder('budgets', 'Budgets', 'personal'),
  folder('shared', 'Someone else’s folder', null, 'admin'),
  { ...folder('space', 'A whole Space'), kind: 'space' },
];
const copied: WorkspaceItem = {
  ...source,
  id: 'new-copy',
  name: 'Monthly budget (copy)',
  createdAt: 1,
  updatedAt: 1,
  tags: [],
};
const catalog = { 'GET /api/items': { items } };
const success = { ...catalog, 'POST /api/items/source/copy': { item: copied } };
const meta = {
  id: 'dashboard-duplicate-file',
  title: 'Current production/Dashboard/DuplicateFile',
  component: DuplicateFile,
  args: {
    source,
    dirty: false,
    saveReady: true,
    onCreated: fn(),
    onOpen: fn(() => false),
    onCheckDestination: fn(() => false),
    onClose: fn(),
  },
} satisfies Meta<typeof DuplicateFile>;
export default meta;
type Story = StoryObj<typeof meta>;
async function ready(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  const dialog = await body.findByRole('dialog', { name: /^Duplicate file$/ });
  const canvas = within(dialog);
  await waitFor(() => expect(canvas.queryByText('Loading destinations…')).not.toBeInTheDocument());
  return { canvas, dialog };
}
async function submit(canvasElement: HTMLElement) {
  const { canvas, dialog } = await ready(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: /^Duplicate$/ }));
  return { canvas, dialog };
}
export const Default: Story = {
  parameters: { api: success },
  play: async ({ canvasElement }) => {
    const { canvas, dialog } = await ready(canvasElement);
    await expect(canvas.getByLabelText('Name')).toHaveValue(copied.name);
    await expect(canvas.getByLabelText('Destination')).toHaveValue('budgets');
    await expect(canvas.getByRole('option', { name: /^Personal \/ Budgets$/ })).toBeInTheDocument();
    await expect(
      canvas.queryByRole('option', { name: /Someone else|A whole Space/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText('People with access to the destination folder may also have access.'),
    ).toBeVisible();
    await assertDialogControls(dialog);
  },
};
export const Dark: Story = { ...Default, globals: { theme: 'dark' } };
export const Phone: Story = {
  ...Default,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
export const SharedDocument: Story = {
  args: { source: { ...source, kind: 'doc', access: 'viewer' } },
  parameters: { api: catalog },
  play: async ({ canvasElement }) => {
    const { canvas } = await ready(canvasElement);
    await expect(canvas.getByLabelText('Destination')).toHaveValue('');
    await expect(
      canvas.queryByText('People with access to the destination folder may also have access.'),
    ).not.toBeInTheDocument();
  },
};
export const SpacePage: Story = {
  args: { source: { ...source, kind: 'doc', spaceId: 'space' } },
  parameters: { api: catalog },
  play: async ({ canvasElement }) => {
    const { canvas } = await ready(canvasElement);
    await expect(canvas.getByLabelText('Destination')).toHaveValue('');
  },
};
export const LoadingDestinations: Story = {
  parameters: { api: { 'GET /api/items': pending() } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Loading destinations…')).toBeVisible();
    await expect(body.getByRole('button', { name: /^Duplicate$/ })).toBeDisabled();
  },
};
export const DestinationFailure: Story = {
  parameters: { api: { 'GET /api/items': failure('Unavailable', 503) } },
  play: async ({ canvasElement }) => {
    const { canvas } = await ready(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Could not load destinations. Try again.',
    );
    await expect(canvas.getByRole('button', { name: /^Duplicate$/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /^Try again$/ })).toBeEnabled();
  },
};
export const UnsavedOriginal: Story = {
  args: { dirty: true },
  parameters: { api: catalog },
  play: async ({ canvasElement }) => {
    const { canvas } = await ready(canvasElement);
    await expect(canvas.getByRole('button', { name: /^Duplicate$/ })).toBeDisabled();
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Wait for the original’s changes to be saved',
    );
  },
};
export const OriginalNotReady: Story = {
  ...UnsavedOriginal,
  args: { dirty: false, saveReady: false },
};
export const Copying: Story = {
  parameters: { api: { ...catalog, 'POST /api/items/source/copy': pending() } },
  play: async ({ canvasElement }) => {
    const { canvas, dialog } = await submit(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('Making copy…');
    await expect(canvas.getByLabelText('Name')).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /^Duplicate$/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /^Close$/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /^Close dialog$/ })).toBeDisabled();
    await assertDialogControls(dialog);
  },
};
export const Refused: Story = {
  parameters: {
    api: { ...catalog, 'POST /api/items/source/copy': failure('Choose a folder you own.', 403) },
  },
  play: async ({ canvasElement }) => {
    const { canvas } = await submit(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Choose a folder you own.');
    await expect(canvas.getByLabelText('Name')).toHaveValue(copied.name);
    await expect(canvas.getByLabelText('Destination')).toHaveValue('budgets');
    await expect(canvas.getByRole('button', { name: /^Duplicate$/ })).toBeEnabled();
  },
};
async function uncertain(canvasElement: HTMLElement) {
  const { canvas, dialog } = await submit(canvasElement);
  await expect(await canvas.findByRole('alert')).toHaveTextContent(
    'Could not confirm whether the copy was created. Check Personal / Budgets before trying again.',
  );
  await expect(canvas.getByLabelText('Name')).toBeDisabled();
  await expect(canvas.getByLabelText('Destination')).toBeDisabled();
  await expect(canvas.queryByRole('button', { name: /^Duplicate$/ })).not.toBeInTheDocument();
  await expect(canvas.getByRole('button', { name: /^Check destination$/ })).toBeEnabled();
  await expect(canvas.getByRole('button', { name: /^Close$/ })).toBeEnabled();
  await assertDialogControls(dialog);
}
export const Uncertain: Story = {
  parameters: { api: { ...catalog, 'POST /api/items/source/copy': failure('Server failed', 503) } },
  play: ({ canvasElement }) => uncertain(canvasElement),
};
export const MalformedResponse: Story = {
  parameters: { api: { ...catalog, 'POST /api/items/source/copy': {} } },
  play: ({ canvasElement }) => uncertain(canvasElement),
};
export const CreatedNavigationBlocked: Story = {
  parameters: { api: success },
  play: async ({ canvasElement, args }) => {
    const { canvas } = await submit(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent(
        `Created ${copied.name} in Personal / Budgets.`,
      ),
    );
    await waitFor(() => expect(canvas.getByRole('button', { name: /^Open copy$/ })).toBeEnabled());
    await expect(args.onCreated).toHaveBeenCalledWith(copied);
    await expect(args.onOpen).toHaveBeenCalledWith(copied);
    await expect(canvas.queryByRole('button', { name: /^Duplicate$/ })).not.toBeInTheDocument();
  },
};
export const CreatedNavigationFailure: Story = {
  args: {
    onOpen: fn(() => {
      throw new Error('Navigation failed');
    }),
  },
  parameters: { api: success },
  play: async ({ canvasElement }) => {
    const { canvas } = await submit(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The copy was created, but could not be opened.',
    );
    await expect(canvas.queryByRole('button', { name: /^Duplicate$/ })).not.toBeInTheDocument();
  },
};
export const CreatedRefreshFailure: Story = {
  args: {
    onCreated: fn(async () => {
      throw new Error('Refresh failed');
    }),
  },
  parameters: { api: success },
  play: async ({ canvasElement }) => {
    const { canvas } = await submit(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The copy was created, but the file list could not refresh.',
    );
    await expect(canvas.getByRole('button', { name: /^Open copy$/ })).toBeEnabled();
  },
};

export const DoubleSubmit: Story = {
  parameters: { api: success },
  play: async ({ canvasElement }) => {
    const { canvas, dialog } = await ready(canvasElement);
    const original = globalThis.fetch;
    let count = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST') {
        count++;
        await held;
      }
      return original(input, init);
    };
    try {
      const form = dialog.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => expect(count).toBe(1));
      await expect(canvas.getByRole('button', { name: /^Duplicate$/ })).toBeDisabled();
      release();
      await waitFor(() =>
        expect(canvas.getByRole('button', { name: /^Open copy$/ })).toBeEnabled(),
      );
      await userEvent.click(canvas.getByRole('button', { name: /^Open copy$/ }));
      await expect(count).toBe(1);
    } finally {
      release();
      globalThis.fetch = original;
    }
  },
};
export const ExplicitRetry: Story = {
  parameters: { api: success },
  play: async ({ canvasElement }) => {
    const { canvas } = await ready(canvasElement);
    const original = globalThis.fetch;
    let count = 0;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST' && ++count === 1)
        return new Response(
          JSON.stringify({ error: 'The destination is not available. Choose another folder.' }),
          { status: 409 },
        );
      return original(input, init);
    };
    try {
      await userEvent.click(canvas.getByRole('button', { name: /^Duplicate$/ }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
        'The destination is not available.',
      );
      await expect(count).toBe(1);
      await expect(canvas.getByLabelText('Name')).toHaveValue(copied.name);
      await userEvent.click(canvas.getByRole('button', { name: /^Duplicate$/ }));
      await waitFor(() =>
        expect(canvas.getByRole('button', { name: /^Open copy$/ })).toBeEnabled(),
      );
      await expect(count).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  },
};
export const NetworkFailure: Story = {
  parameters: { api: catalog },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const original = globalThis.fetch;
    let count = 0;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST') {
        count++;
        throw new TypeError('Network failed');
      }
      return original(input, init);
    };
    try {
      await uncertain(canvasElement);
      await expect(count).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  },
};

const timedOutCreated = fn();
const timedOutOpen = fn(() => false);
export const ResponseBodyTimeout: Story = {
  args: { onCreated: timedOutCreated, onOpen: timedOutOpen },
  parameters: { api: catalog },
  play: async ({ canvasElement }) => {
    const { canvas } = await ready(canvasElement);
    timedOutCreated.mockClear();
    timedOutOpen.mockClear();
    const originalFetch = globalThis.fetch;
    const originalTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    let release!: (value: unknown) => void;
    let signal: AbortSignal | null | undefined;
    const body = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 30_000 && typeof handler === 'function') expire = () => handler();
      return originalTimeout(handler, delay, ...args);
    }) as typeof globalThis.setTimeout;
    globalThis.fetch = async (input, init) => {
      if (init?.method !== 'POST') return originalFetch(input, init);
      signal = init.signal;
      const reply = new Response('', { status: 201 });
      Object.defineProperty(reply, 'json', { value: () => body });
      return reply;
    };
    try {
      await userEvent.click(canvas.getByRole('button', { name: /^Duplicate$/ }));
      await waitFor(() => expect(expire).toBeDefined());
      expire!();
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
        'Could not confirm whether the copy was created.',
      );
      await expect(signal?.aborted).toBe(true);
      release({ item: copied });
      await body;
      await expect(timedOutCreated).not.toHaveBeenCalled();
      await expect(timedOutOpen).not.toHaveBeenCalled();
      await expect(canvas.queryByRole('button', { name: /^Duplicate$/ })).not.toBeInTheDocument();
      await expect(canvas.getByRole('button', { name: /^Close$/ })).toBeEnabled();
    } finally {
      release({ item: copied });
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalTimeout;
    }
  },
};

function ChangingSource(props: ComponentProps<typeof DuplicateFile>) {
  const [replacement, setReplacement] = useState(false);
  useEffect(() => {
    const change = () => setReplacement(true);
    document.addEventListener('duplicate-source-change', change);
    return () => document.removeEventListener('duplicate-source-change', change);
  }, []);
  return (
    <DuplicateFile
      {...props}
      source={replacement ? { ...source, id: 'next-source', name: 'Another budget' } : props.source}
    />
  );
}
const staleCreated = fn();
const staleOpen = fn(() => false);
export const SourceChangesWhilePending: Story = {
  args: { onCreated: staleCreated, onOpen: staleOpen },
  render: (args) => <ChangingSource {...args} />,
  parameters: { api: success },
  play: async ({ canvasElement }) => {
    const { canvas } = await ready(canvasElement);
    staleCreated.mockClear();
    staleOpen.mockClear();
    const original = globalThis.fetch;
    let signal: AbortSignal | null | undefined;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST') {
        signal = init.signal;
        await held;
      }
      return original(input, init);
    };
    try {
      await userEvent.click(canvas.getByRole('button', { name: /^Duplicate$/ }));
      await waitFor(() => expect(signal).toBeDefined());
      document.dispatchEvent(new Event('duplicate-source-change'));
      await waitFor(() => expect(signal?.aborted).toBe(true));
      await waitFor(() =>
        expect(canvas.getByLabelText('Name')).toHaveValue('Another budget (copy)'),
      );
      release();
      await held;
      await waitFor(() =>
        expect(canvas.getByRole('button', { name: /^Duplicate$/ })).toBeEnabled(),
      );
      await expect(staleCreated).not.toHaveBeenCalled();
      await expect(staleOpen).not.toHaveBeenCalled();
      await expect(canvas.queryByText(/Created Monthly budget/)).not.toBeInTheDocument();
    } finally {
      release();
      globalThis.fetch = original;
    }
  },
};
