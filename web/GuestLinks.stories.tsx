import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { GuestLinks } from './GuestLinks.tsx';
import { guestLinkExamples as items } from './guestLinksStoryData.ts';

const list = 'GET /api/guest-links';
const patch = `PATCH /api/guest-links/${items[0].id}`;
const remove = `DELETE /api/guest-links/${items[0].id}`;
const updated = { ...items[0], expiresAt: null };
const api = { [list]: { items }, [patch]: updated, [remove]: {} };
const meta = {
  title: 'Current production/Account/Guest links',
  component: GuestLinks,
  parameters: { shell: 'none' },
  decorators: [
    (Story) => (
      <div style={{ padding: 24, maxWidth: 688 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GuestLinks>;
export default meta;
type Story = StoryObj<typeof meta>;

async function menu(canvasElement: HTMLElement, name = items[0].name) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: `More actions for ${name}` }));
  return within(document.body);
}
async function expiry(canvasElement: HTMLElement) {
  const body = await menu(canvasElement);
  await userEvent.click(await body.findByRole('menuitem', { name: 'Change expiry…' }));
  return within(await body.findByRole('dialog', { name: 'Change link expiry' }));
}

export const Inventory: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('list', { name: 'Your guest links' })).toBeVisible();
    await expect(canvas.getByText('Enabled date unknown · Never expires')).toBeVisible();
    await expect(
      canvas.getByText('Every current and future page and folder in this Space.'),
    ).toBeVisible();
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument();
    for (const link of canvas.getAllByRole('link'))
      await expect(link.getAttribute('href')).not.toContain('/share/');
  },
};
export const Empty: Story = { parameters: { api: { [list]: { items: [] } } } };
export const Loading: Story = { parameters: { api: { [list]: pending() } } };
export const LoadError: Story = { parameters: { api: { [list]: failure('Unavailable', 503) } } };
export const LoadRetry: Story = {
  parameters: { api: { [list]: failure('Unavailable', 503) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: 'Reload guest links' });
    const previous = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({ items });
      await userEvent.click(canvas.getByRole('button', { name: 'Reload guest links' }));
      await expect(await canvas.findByRole('link', { name: items[0].name })).toBeVisible();
    } finally {
      globalThis.fetch = previous;
    }
  },
};
export const ChangeExpiry: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    await expiry(canvasElement);
  },
};
export const ExpirySaved: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await expiry(canvasElement);
    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: 'Expire link after' }),
      'never',
    );
    const previous = globalThis.fetch;
    const writes: unknown[] = [];
    try {
      globalThis.fetch = async (input, init) => {
        if (init?.method === 'PATCH') writes.push(JSON.parse(String(init.body)));
        return previous(input, init);
      };
      await userEvent.click(dialog.getByRole('button', { name: 'Save expiry' }));
      await expect(await within(canvasElement).findByRole('status')).toHaveTextContent(
        'Expiry updated. The link is unchanged.',
      );
      await expect(writes).toEqual([
        { epoch: items[0].epoch, expectedExpiresAt: items[0].expiresAt, expiryDays: null },
      ]);
      await expect(
        within(canvasElement).getByRole('button', { name: `More actions for ${items[0].name}` }),
      ).toHaveFocus();
    } finally {
      globalThis.fetch = previous;
    }
  },
};
export const Saving: Story = {
  parameters: { api: { ...api, [patch]: pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await expiry(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Save expiry' }));
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(within(document.body).getByRole('dialog')).toBeVisible();
  },
};
export const UncertainWrite: Story = {
  parameters: { api: { ...api, [patch]: failure('Connection lost', 503) } },
  play: async ({ canvasElement }) => {
    const dialog = await expiry(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Save expiry' }));
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Review current guest links',
    );
    await expect(within(canvasElement).getByRole('link', { name: items[0].name })).toBeVisible();
  },
};
export const StaleLink: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const dialog = await expiry(canvasElement);
    const previous = globalThis.fetch;
    try {
      globalThis.fetch = async (_input, init) =>
        init?.method === 'PATCH'
          ? Response.json({ error: 'This link changed.' }, { status: 409 })
          : Response.json({
              items: items.map((item) =>
                item.id === items[0].id ? { ...item, epoch: 9, expiresAt: null } : item,
              ),
            });
      await userEvent.click(dialog.getByRole('button', { name: 'Save expiry' }));
      await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
        'Review current guest links',
      );
      await expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      globalThis.fetch = previous;
    }
  },
};
export const TurnOffSpace: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const body = await menu(canvasElement, items[2].name);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Turn off link' }));
    await expect(await body.findByRole('dialog')).toHaveTextContent('Space and all its pages');
  },
};
export const TurnedOff: Story = {
  parameters: { api },
  play: async ({ canvasElement }) => {
    const body = await menu(canvasElement);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Turn off link' }));
    const dialog = within(await body.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Turn off link' }));
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.queryByRole('link', { name: items[0].name })).not.toBeInTheDocument(),
    );
    await expect(canvas.getByRole('heading', { name: 'Guest links' })).toHaveFocus();
  },
};
export const Expired: Story = {
  parameters: { api: { [list]: { items: [items[3]] } } },
  play: async ({ canvasElement }) => {
    const body = await menu(canvasElement, items[3].name);
    await expect(body.queryByRole('menuitem', { name: 'Change expiry…' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  },
};
export const Phone: Story = {
  parameters: {
    api: {
      [list]: {
        items: items.map((item, index) =>
          index === 0
            ? { ...item, name: 'Autumn plans with family and friends — the full shared itinerary' }
            : item,
        ),
      },
    },
  },
  globals: { viewport: { value: 'phone', isRotated: false } },
};

function AccountSwitch() {
  const [account, setAccount] = useState(0);
  return (
    <>
      <button onClick={() => setAccount((value) => value + 1)}>Switch account</button>
      <GuestLinks key={account} />
    </>
  );
}
export const StaleAccountResponse: Story = {
  render: () => <AccountSwitch />,
  parameters: { api: { [list]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const previous = globalThis.fetch;
    try {
      for (const status of [200, 401]) {
        let resolveOld: ((response: Response) => void) | undefined;
        globalThis.fetch = () =>
          new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        await userEvent.click(canvas.getByRole('button', { name: 'Switch account' }));
        await waitFor(() => expect(resolveOld).toBeDefined());
        globalThis.fetch = async () => Response.json({ items: [] });
        await userEvent.click(canvas.getByRole('button', { name: 'Switch account' }));
        await expect(
          await canvas.findByText('No guest links. Create one from a file’s Share dialog.'),
        ).toBeVisible();
        const address = location.href;
        resolveOld?.(Response.json(status === 200 ? { items } : { error: 'Sign in.' }, { status }));
        // Drain the old fetch's microtasks before checking absence/redirects.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await expect(canvas.queryByRole('link', { name: items[0].name })).not.toBeInTheDocument();
        await expect(
          canvas.getByText('No guest links. Create one from a file’s Share dialog.'),
        ).toBeVisible();
        await expect(location.href).toBe(address);
      }
    } finally {
      globalThis.fetch = previous;
    }
  },
};
