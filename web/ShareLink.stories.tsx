import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { ShareLink } from './ShareLink.tsx';

const id = '00000000-0000-4000-8000-000000000071';
const link = `GET /api/items/${id}/link`;
const url =
  'https://spinel.example.com/share/00000000-0000-4000-8000-000000000071?preview=public-title-preview#k3Yq9mZpV2xT';

// Each story sets `parameters.api` in full: Storybook deep-merges parameters, which
// would fold a failure() or pending() reply into the plain body set on the meta.

const meta = {
  id: 'sharing-sharelink',
  title: 'Current production/Sharing/ShareLink',
  component: ShareLink,
  args: { id },
} satisfies Meta<typeof ShareLink>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Controls are disabled until the current link state arrives. */
export const Loading: Story = { parameters: { api: { [link]: pending() } } };
export const LinkOff: Story = {
  parameters: { api: { [link]: { enabled: false, role: 'viewer' } } },
};
export const LinkOnViewOnly: Story = {
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url } } },
};
export const LinkOnCanEdit: Story = {
  parameters: { api: { [link]: { enabled: true, role: 'editor', url } } },
};
/** The address is only shown when the link is created; later visits cannot recover it. */
export const LinkOnWithoutUrl: Story = {
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url: null } } },
};
export const Failed: Story = {
  parameters: { api: { [link]: failure('Only the owner can manage the guest link.', 403) } },
};
export const SpaceViewLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url } } },
};
export const SpaceEditLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'editor', url } } },
};
export const ConfirmWholeSpace: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: false, role: 'viewer' } } },
  play: async ({ canvasElement }) => {
    const create = await within(canvasElement).findByRole('button', { name: 'Create link' });
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Share the whole Space?',
    });
    await expect(within(dialog).getByRole('button', { name: 'Create view link' })).toBeVisible();
  },
};
export const ConfirmReplacementEditLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const access = await canvas.findByLabelText('Link access');
    await waitFor(() => expect(access).toBeEnabled());
    await userEvent.selectOptions(access, 'editor');
    await expect(access).toHaveValue('editor');
    await userEvent.click(canvas.getByRole('button', { name: 'Guest link actions' }));
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('menuitem', { name: 'Replace link…' }),
    );
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Replace the link?',
    });
    await expect(within(dialog).getByRole('button', { name: 'Replace link' })).toBeVisible();
  },
};
export const ConfirmTurnOffSpaceLink: Story = {
  args: { space: true },
  parameters: { api: { [link]: { enabled: true, role: 'editor', url } } },
  play: async ({ canvasElement }) => {
    const actions = await within(canvasElement).findByRole('button', {
      name: 'Guest link actions',
    });
    await userEvent.click(actions);
    const turnOff = await within(canvasElement.ownerDocument.body).findByRole('menuitem', {
      name: 'Turn off link',
    });
    await waitFor(() => expect(turnOff).toBeEnabled());
    await userEvent.click(turnOff);
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Turn off this Space link?',
      }),
    ).toBeVisible();
  },
};

/** Navigation may unmount or replace sharing while the server response is held. */
function StaleLinkResponse({
  method,
  replace = false,
}: {
  method: 'GET' | 'PUT';
  replace?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [left, setLeft] = useState(false);
  const [phase, setPhase] = useState('Ready');
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    const previous = globalThis.fetch;
    const intercepted: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/link')) {
        if (input === `/api/items/${id}/link` && (init?.method ?? 'GET') === method) {
          setPhase('Response held');
          return new Promise<Response>((resolve) => {
            release.current = () => {
              resolve(Response.json({ error: 'Sign in to continue.' }, { status: 401 }));
              setPhase('Response released');
            };
          });
        }
        return Response.json({ enabled: false, role: 'viewer' });
      }
      return previous(input, init);
    };
    globalThis.fetch = intercepted;
    setReady(true);
    return () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = previous;
      release.current = null;
    };
  }, [method]);
  return (
    <div>
      <p>{phase}</p>
      <button data-testid="leave-sharing" onClick={() => setLeft(true)}>
        Simulate navigation
      </button>
      <button data-testid="release-sharing" onClick={() => release.current?.()}>
        Release response
      </button>
      {left && <p>Current Space writing is still open.</p>}
      {ready && (!left || replace) && <ShareLink id={left ? 'next-space' : id} space />}
    </div>
  );
}
async function finishStaleLink(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByText('Response held');
  fireEvent.click(canvas.getByTestId('leave-sharing'));
  await canvas.findByText('Current Space writing is still open.');
  const href = window.location.href;
  fireEvent.click(canvas.getByTestId('release-sharing'));
  await canvas.findByText('Response released');
  // The immediate Response and async error handlers settle before the next frame.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await expect(window.location.href).toBe(href);
  await expect(canvas.getByText('Current Space writing is still open.')).toBeVisible();
  await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
}
export const LoadAfterLeavingSpace: Story = {
  render: () => <StaleLinkResponse method="GET" />,
  play: ({ canvasElement }) => finishStaleLink(canvasElement),
};
export const ChangeAfterReplacingSpace: Story = {
  render: () => <StaleLinkResponse method="PUT" replace />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const create = await canvas.findByRole('button', { name: 'Create link' });
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Share the whole Space?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create view link' }));
    await finishStaleLink(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Create link' })).toBeEnabled();
  },
};

export const CreatedLink: Story = {
  parameters: {
    api: {
      [link]: { enabled: false, role: 'viewer' },
      [`PUT /api/items/${id}/link`]: { enabled: true, role: 'viewer', url },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Create link' }));
    await expect(await canvas.findByLabelText('Guest link address')).toHaveValue(url);
    await expect(canvas.getByRole('button', { name: 'Copy guest link' })).toBeVisible();
  },
};
export const NoSecretReadback: Story = {
  parameters: { api: { [link]: { enabled: true, role: 'viewer', url } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('Replace the link to copy a new address.');
    await expect(canvas.queryByLabelText('Guest link address')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Copy guest link' })).not.toBeInTheDocument();
  },
};
export const Creating: Story = {
  parameters: {
    api: { [link]: { enabled: false, role: 'viewer' }, [`PUT /api/items/${id}/link`]: pending() },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Create link' }));
    await expect(
      canvas.getByText('Off. Only people with access can open this item.'),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Create link' })).toBeDisabled();
    await expect(canvas.queryByLabelText('Guest link address')).not.toBeInTheDocument();
  },
};
export const FailedCreate: Story = {
  parameters: {
    api: {
      [link]: { enabled: false, role: 'viewer' },
      [`PUT /api/items/${id}/link`]: failure('Could not create a link.', 503),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Create link' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not create a link.');
    await expect(canvas.queryByLabelText('Guest link address')).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Retry link update' })).toBeEnabled();
  },
};
export const FailedReplacement: Story = {
  parameters: {
    api: {
      [link]: { enabled: true, role: 'viewer' },
      [`PUT /api/items/${id}/link`]: failure(
        'Only the owner or a file admin can manage this item.',
        403,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await canvas.findByLabelText('Link access'), 'editor');
    await userEvent.click(canvas.getByRole('button', { name: 'Guest link actions' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Replace link…' }));
    const dialog = within(await body.findByRole('dialog', { name: 'Replace the link?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Replace link', exact: true }));
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Only the owner or a file admin',
    );
    await expect(canvas.getByText('Guests can view.')).toBeInTheDocument();
    await expect(canvas.getByLabelText('Link access')).toHaveValue('editor');
    await expect(canvas.queryByLabelText('Guest link address')).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Guest link actions' })).toHaveFocus(),
    );
  },
};
export const FailedTurnOff: Story = {
  parameters: {
    api: {
      [link]: { enabled: true, role: 'editor' },
      [`PUT /api/items/${id}/link`]: failure('Could not turn off the link.', 503),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Guest link actions' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Turn off link' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Could not turn off the link.',
    );
    await expect(canvas.getByText('Guests can edit.')).toBeVisible();
  },
};
