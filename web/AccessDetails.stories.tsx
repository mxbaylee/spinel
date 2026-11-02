import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, waitFor, within } from 'storybook/test';
import type { ItemAccessDetails } from '../src/shared/workspace.ts';
import { failure, pending } from '../.storybook/api.ts';
import { AccessDetails } from './AccessDetails.tsx';

const item = { id: '00000000-0000-4000-8000-000000000071', name: 'Monthly budget' };
const path = `GET /api/items/${item.id}/access`;
const folder = { kind: 'folder' as const, id: 'readable-folder', name: 'Budgets' };
const space = { id: '00000000-0000-4000-8000-000000000078', name: 'Household' };
const inherited: ItemAccessDetails = { access: 'editor', source: folder };
const meta = {
  id: 'sharing-access-details',
  title: 'Current production/Sharing/Access details',
  component: AccessDetails,
  args: { item, onClose: () => {} },
} satisfies Meta<typeof AccessDetails>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InheritedFolder: Story = {
  parameters: { api: { [path]: { details: inherited } } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Editor through Budgets')).toBeVisible();
    await expect(body.queryByText('Shared directly with you.')).not.toBeInTheDocument();
  },
};

export const DirectShare: Story = {
  parameters: { api: { [path]: { details: { access: 'viewer', source: { kind: 'direct' } } } } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Shared directly with you.')).toBeVisible();
    await expect(body.queryByText(/through/)).not.toBeInTheDocument();
  },
};

export const SpaceThroughFolder: Story = {
  args: { item: { ...item, spaceId: space.id } },
  parameters: { api: { [path]: { details: { ...inherited, space } } } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Editor through Budgets')).toBeVisible();
    await expect(
      body.getByText(/Access applies to every current and future page and folder in/),
    ).toHaveTextContent('Household');
  },
};

export const SpaceDirect: Story = {
  args: { item: { ...item, spaceId: space.id } },
  parameters: {
    api: { [path]: { details: { access: 'viewer', source: { kind: 'space', ...space }, space } } },
  },
};

export const Owner: Story = {
  parameters: { api: { [path]: { details: { access: 'owner', source: { kind: 'owner' } } } } },
};

export const FileAdmin: Story = {
  parameters: { api: { [path]: { details: { ...inherited, access: 'admin' } } } },
};

export const LongNames: Story = {
  args: { item: { ...item, name: 'Monthly spending and savings for our shared household' } },
  parameters: {
    api: {
      [path]: {
        details: {
          ...inherited,
          source: { ...folder, name: 'Household budgets, recurring expenses and long-term plans' },
          space: { ...space, name: 'Planning our next year together' },
        },
      },
    },
  },
};

export const Loading: Story = {
  parameters: { api: { [path]: pending() } },
};

export const Unavailable: Story = {
  parameters: { api: { [path]: failure('This item is not available.', 404) } },
};

function RevokedFixture() {
  const [ready, setReady] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const previous = globalThis.fetch;
    let mode: 'allowed' | 'held' | 'denied' = 'allowed';
    let release: (() => void) | undefined;
    const response = () => Response.json({ details: inherited });
    const intercepted: typeof fetch = async (input, init) => {
      if (String(input).includes(`/api/items/${item.id}/access`)) {
        if (mode === 'denied')
          return Response.json({ error: 'This item is not available.' }, { status: 404 });
        if (mode === 'held')
          return new Promise<Response>((resolve) => {
            release = () => resolve(response());
            setHeld(true);
          });
        return response();
      }
      return previous(input, init);
    };
    const hold = () => {
      mode = 'held';
      window.dispatchEvent(new Event('focus'));
    };
    const revoke = () => {
      mode = 'denied';
      window.dispatchEvent(new Event('focus'));
    };
    const finish = () => release?.();
    globalThis.fetch = intercepted;
    window.addEventListener('access-story-hold', hold);
    window.addEventListener('access-story-revoke', revoke);
    window.addEventListener('access-story-release', finish);
    setReady(true);
    return () => {
      window.removeEventListener('access-story-hold', hold);
      window.removeEventListener('access-story-revoke', revoke);
      window.removeEventListener('access-story-release', finish);
      if (globalThis.fetch === intercepted) globalThis.fetch = previous;
    };
  }, []);
  return ready ? (
    <>
      <output hidden data-testid="held-access-request">
        {String(held)}
      </output>
      <AccessDetails item={item} onClose={() => {}} />
    </>
  ) : null;
}

/** A late successful response must not restore a name after a newer denial. */
export const RevokedWhileOpen: Story = {
  render: () => <RevokedFixture />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Editor through Budgets')).toBeVisible();
    fireEvent(window, new Event('access-story-hold'));
    await waitFor(() => expect(body.getByTestId('held-access-request')).toHaveTextContent('true'));
    fireEvent(window, new Event('access-story-revoke'));
    await expect(await body.findByRole('alert')).toHaveTextContent('This item is not available.');
    fireEvent(window, new Event('access-story-release'));
    // Let the held fetch and React update settle before asserting absence.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await waitFor(() => {
      expect(body.queryByText('Editor through Budgets')).not.toBeInTheDocument();
      expect(body.getByRole('alert')).toHaveTextContent('This item is not available.');
    });
  },
};
