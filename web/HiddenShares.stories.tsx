import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { FileItem } from '../src/shared/workspace.ts';
import { searchCatalog } from '../src/shared/search.ts';
import { Dashboard } from './Dashboard.tsx';

const doc: FileItem = {
  id: '07100000-0000-4000-8000-000000000001',
  name: 'Journey notes',
  kind: 'doc',
  parentId: null,
  access: 'editor',
  ownerName: 'Alex Kim',
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
  sharedAt: 1_790_000_000_000,
  tags: ['travel'],
};
const space: FileItem = {
  ...doc,
  id: '07100000-0000-4000-8000-000000000002',
  name: 'Family plans',
  kind: 'space',
  access: 'viewer',
  tags: [],
};

function Fixture({
  children,
  initiallyHidden = false,
  mode = 'success',
}: {
  children: ReactNode;
  initiallyHidden?: boolean | 'all';
  mode?: 'success' | 'failure' | 'pending';
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previousFetch = globalThis.fetch;
    const push = history.pushState;
    const replace = history.replaceState;
    let hidden = Boolean(initiallyHidden);
    const inventory = () => [
      { ...doc, ...(hidden ? { hidden: true as const } : {}) },
      { ...space, ...(initiallyHidden === 'all' ? { hidden: true as const } : {}) },
    ];
    const intercepted: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      );
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/items/shared') return Response.json({ items: inventory() });
      if (url.pathname === '/api/items') return Response.json({ items: [], spacesEnabled: true });
      if (url.pathname === '/api/items/search')
        return Response.json({ items: searchCatalog(inventory()) });
      if (url.pathname === `/api/items/${doc.id}/hidden` && method === 'PUT') {
        if (mode === 'pending') return new Promise<Response>(() => {});
        if (mode === 'failure')
          return Response.json(
            { error: 'Could not update shared items. Try again.' },
            { status: 503 },
          );
        hidden = JSON.parse(String(init?.body)).hidden;
        return Response.json({ items: inventory() });
      }
      return previousFetch(input, init);
    };
    globalThis.fetch = intercepted;
    history.pushState = () => {};
    history.replaceState = () => {};
    setReady(true);
    return () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = previousFetch;
      history.pushState = push;
      history.replaceState = replace;
    };
  }, [initiallyHidden, mode]);
  return ready ? children : <p role="status">Preparing story…</p>;
}

const meta = {
  id: 'dashboard-hidden-shares',
  title: 'Current production/Dashboard/Hidden shares',
  component: Dashboard,
  args: {
    user: { id: 'hidden-shares-reader', name: 'Sam Lee' },
    navigation: { allow: () => true, dirty() {} },
    connection: 'online',
  },
} satisfies Meta<typeof Dashboard>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openShared(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: /^Shared with me$/ }));
  await canvas.findByRole('heading', { name: /^Shared with me$/ });
  return canvas;
}
async function showHidden(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'More actions for Shared with me' }));
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: /^Show hidden$/ }),
  );
}

export const IncludeHidden: Story = {
  decorators: [
    (Story) => (
      <Fixture initiallyHidden>
        <Story />
      </Fixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await openShared(canvasElement);
    await expect(
      canvas.queryByRole('button', { name: 'Journey notes Doc' }),
    ).not.toBeInTheDocument();
    await showHidden(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Journey notes Doc' })).toBeVisible();
    await expect(canvas.getByText('Hidden', { exact: true })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Family plans Space' })).toBeVisible();
  },
};

export const AllSharesHidden: Story = {
  decorators: [
    (Story) => (
      <Fixture initiallyHidden="all">
        <Story />
      </Fixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await openShared(canvasElement);
    const emptyMessage = 'No visible shares. Choose Show hidden from the view menu.';
    await expect(await canvas.findByText(emptyMessage)).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: 'Journey notes Doc' }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('button', { name: 'Family plans Space' }),
    ).not.toBeInTheDocument();
    await showHidden(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Journey notes Doc' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Family plans Space' })).toBeVisible();
    await expect(canvas.getAllByText('Hidden', { exact: true })).toHaveLength(2);
    await expect(canvas.queryByText(emptyMessage)).not.toBeInTheDocument();
    // Return to the empty state so the visual-review artifact covers its guidance.
    await userEvent.click(canvas.getByRole('button', { name: 'More actions for Shared with me' }));
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: /^Hide hidden$/ }),
    );
    await expect(await canvas.findByText(emptyMessage)).toBeVisible();
  },
};

export const HideAndShow: Story = {
  decorators: [
    (Story) => (
      <Fixture>
        <Story />
      </Fixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await openShared(canvasElement);
    const body = within(document.body);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'More actions for Journey notes' }),
    );
    await userEvent.click(await body.findByRole('menuitem', { name: /^Hide$/ }));
    await expect(
      await canvas.findByText('Journey notes is hidden from Shared with me and search.'),
    ).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: 'Journey notes Doc' }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'Shared with me' })).toHaveFocus();
    await showHidden(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'More actions for Journey notes' }),
    );
    await userEvent.click(await body.findByRole('menuitem', { name: /^Show$/ }));
    await expect(
      await canvas.findByText('Journey notes is shown in Shared with me and search.'),
    ).toBeVisible();
    await expect(canvas.queryByText('Hidden', { exact: true })).not.toBeInTheDocument();
  },
};

export const FailedHide: Story = {
  decorators: [
    (Story) => (
      <Fixture mode="failure">
        <Story />
      </Fixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await openShared(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'More actions for Journey notes' }),
    );
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /^Hide$/ }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Could not update shared items. Try again. Refresh shared items',
    );
    await expect(canvas.getByRole('button', { name: 'Journey notes Doc' })).toBeVisible();
  },
};

export const PendingHide: Story = {
  decorators: [
    (Story) => (
      <Fixture mode="pending">
        <Story />
      </Fixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await openShared(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'More actions for Journey notes' }),
    );
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /^Hide$/ }));
    await expect(await canvas.findByText('Updating shared item…')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Journey notes Doc' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'More actions for Journey notes' }));
    await expect(
      await within(document.body).findByRole('menuitem', { name: /^Hide$/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');
  },
};
