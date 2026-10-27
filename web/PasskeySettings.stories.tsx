import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { failure, pending, mockFetch } from '../.storybook/api.ts';
import { PasskeySettings } from './PasskeySettings.tsx';

const keys = [
  {
    id: 'phone',
    name: 'Phone',
    provider: 'Passkey',
    createdAt: 1700000000000,
    lastUsedAt: 1700100000000,
    current: true,
  },
  {
    id: 'laptop',
    name: 'Laptop',
    provider: 'Passkey',
    createdAt: 1700000000000,
    lastUsedAt: 1700000000000,
    current: false,
  },
];
const fresh = { passkeys: keys, verifiedUntil: 4102444800000 };
const stale = { passkeys: keys, verifiedUntil: null };
const read = { 'GET /api/auth/passkeys': fresh };
const staleRead = { 'GET /api/auth/passkeys': stale };
const meta = {
  title: 'Current production/Account/Passkey security',
  component: PasskeySettings,
  args: { onAdd: fn(), onSignedOut: fn() },
} satisfies Meta<typeof PasskeySettings>;
export default meta;
type Story = StoryObj<typeof meta>;

async function remove(canvasElement: HTMLElement, name = 'Laptop') {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: `More actions for ${name}` }));
  const body = within(document.body);
  await userEvent.click(await body.findByRole('menuitem', { name: 'Remove…' }));
  return within(await body.findByRole('dialog', { name: `Remove ${name}?` }));
}
export const Ready: Story = { parameters: { api: read } };
export const Loading: Story = { parameters: { api: { 'GET /api/auth/passkeys': pending() } } };
export const LoadError: Story = {
  parameters: { api: { 'GET /api/auth/passkeys': failure('Could not load passkeys.') } },
};
export const Empty: Story = {
  parameters: { api: { 'GET /api/auth/passkeys': { passkeys: [], verifiedUntil: null } } },
};
export const Adding: Story = { args: { adding: true }, parameters: { api: read } };
export const ConfirmRemoval: Story = {
  parameters: { api: read },
  play: async ({ canvasElement }) => {
    await remove(canvasElement);
  },
};
export const RemoveCurrent: Story = {
  parameters: { api: read },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement, 'Phone');
    await expect(dialog.getByText(/This browser will also be signed out/)).toBeVisible();
  },
};
export const LastPasskey: Story = {
  parameters: { api: { 'GET /api/auth/passkeys': { ...fresh, passkeys: keys.slice(0, 1) } } },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement, 'Phone');
    await expect(dialog.getByRole('alert')).toHaveTextContent(/Add another passkey/);
    await expect(dialog.queryByRole('button', { name: 'Remove passkey' })).toBeNull();
  },
};
export const FreshVerificationRequired: Story = {
  parameters: { api: staleRead },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await expect(dialog.getByRole('button', { name: 'Verify with a passkey' })).toBeVisible();
  },
};
export const VerifyBeforeAdding: Story = {
  parameters: { api: staleRead },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Add a passkey' }),
    );
    await expect(
      await within(document.body).findByRole('dialog', { name: 'Add a passkey' }),
    ).toBeVisible();
    await expect(args.onAdd).not.toHaveBeenCalled();
  },
};
export const VerificationPending: Story = {
  parameters: { api: { ...staleRead, 'POST /api/auth/reauthentication/options': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await expect(dialog.getByRole('status')).toHaveTextContent(/Follow the instructions/);
  },
};
export const VerificationFailed: Story = {
  parameters: {
    api: { ...staleRead, 'POST /api/auth/reauthentication/options': failure('Expired') },
  },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await expect(dialog.getByRole('alert')).toHaveTextContent(/verification did not finish/);
  },
};
export const Saving: Story = {
  parameters: { api: { ...read, 'POST /api/auth/passkeys/laptop/remove': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Remove passkey' }));
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  },
};
export const Refused: Story = {
  parameters: {
    api: {
      ...read,
      'POST /api/auth/passkeys/laptop/remove': failure(
        'Add another passkey before removing your last one.',
        409,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Remove passkey' }));
    await expect(dialog.getByRole('alert')).toHaveTextContent(/Add another passkey/);
  },
};
export const ProofExpired: Story = {
  parameters: {
    api: { ...read, 'POST /api/auth/passkeys/laptop/remove': failure('Verify again.', 428) },
  },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Remove passkey' }));
    await expect(dialog.getByRole('button', { name: 'Verify with a passkey' })).toBeVisible();
  },
};
export const Uncertain: Story = {
  parameters: {
    api: {
      ...read,
      'POST /api/auth/passkeys/laptop/remove': failure('Connections could not refresh.', 503),
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Remove passkey' }));
    await expect(dialog.getByRole('alert')).toHaveTextContent(/may already be saved/);
    await expect(dialog.queryByRole('button', { name: 'Remove passkey' })).toBeNull();
  },
};
export const SignOutOthers: Story = {
  parameters: { api: read },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Sign out other devices' }),
    );
    await expect(
      await within(document.body).findByRole('dialog', { name: 'Sign out other devices?' }),
    ).toBeVisible();
  },
};
export const OthersSignedOut: Story = {
  parameters: { api: { ...read, 'POST /api/auth/sign-out-others': { signedOutOthers: true } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Sign out other devices' }));
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Sign out other devices?' }),
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Sign out other devices' }));
    await expect(await canvas.findByRole('status')).toHaveTextContent(
      /This browser stays signed in/,
    );
  },
};
export const RemovalCancelled: Story = {
  parameters: { api: read },
  play: async ({ canvasElement }) => {
    await remove(canvasElement);
    await userEvent.keyboard('{Escape}');
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
    await expect(
      within(canvasElement).getByRole('button', { name: 'More actions for Laptop' }),
    ).toHaveFocus();
  },
};

export const VerifiedThenConfirmed: Story = {
  args: {
    authenticate: fn(async () => ({
      id: 'phone',
      rawId: 'phone',
      type: 'public-key' as const,
      response: { authenticatorData: 'fixture', clientDataJSON: 'fixture', signature: 'fixture' },
      clientExtensionResults: {},
    })),
  },
  parameters: {
    api: {
      ...staleRead,
      'POST /api/auth/reauthentication/options': {
        options: { challenge: 'fixture' },
        challengeId: 'fixture',
      },
      'POST /api/auth/reauthentication/verify': { verifiedUntil: 4102444800000 },
      'POST /api/auth/cancel': {},
      'POST /api/auth/sign-out-others': { signedOutOthers: true },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Sign out other devices' }));
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Sign out other devices?' }),
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await expect(await dialog.findByRole('status')).toHaveTextContent(/Confirm the change below/);
    await expect(args.authenticate).toHaveBeenCalledTimes(1);
    // Successful verification leaves the confirmation open; no automatic revocation.
    await userEvent.click(dialog.getByRole('button', { name: 'Sign out other devices' }));
    await expect(await canvas.findByRole('status')).toHaveTextContent(
      /This browser stays signed in/,
    );
  },
};
export const VerificationCancelled: Story = {
  parameters: { api: { ...staleRead, 'POST /api/auth/reauthentication/options': pending() } },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
    await expect(
      within(canvasElement).getByRole('button', { name: 'Add a passkey' }),
    ).toBeEnabled();
    await expect(within(canvasElement).getByRole('list')).toBeVisible();
  },
};
export const UncertainCannotRepeat: Story = {
  parameters: {
    api: { ...read, 'POST /api/auth/passkeys/laptop/remove': failure('No acknowledgement', 503) },
  },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Remove passkey' }));
    await expect(dialog.getByRole('button', { name: 'Reload profile' })).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Reload profile' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Sign out other devices' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'More actions for Laptop' }));
    await expect(
      await within(document.body).findByRole('menuitem', { name: 'Remove…' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');
  },
};
export const MalformedAcknowledgement: Story = {
  parameters: {
    api: { ...read, 'POST /api/auth/sign-out-others': { error: 'Unexpected response' } },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Sign out other devices' }),
    );
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Sign out other devices?' }),
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Sign out other devices' }));
    await expect(dialog.getByRole('alert')).toHaveTextContent(/result could not be confirmed/);
  },
};

export const UnattributedSession: Story = {
  parameters: {
    api: {
      'GET /api/auth/passkeys': {
        ...fresh,
        passkeys: keys.map((key) => ({ ...key, current: false })),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = await remove(canvasElement);
    await expect(dialog.getByText(/This browser will also be signed out/)).toBeVisible();
  },
};
export const RegistrationProofInvalidated: Story = {
  args: { verificationRequired: 1 },
  parameters: { api: read },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Add a passkey' }),
    );
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Add a passkey' }),
    );
    await expect(dialog.getByRole('button', { name: 'Verify with a passkey' })).toBeVisible();
    await expect(args.onAdd).not.toHaveBeenCalled();
  },
};

export const ReadRetryRecovered: Story = {
  parameters: { api: { 'GET /api/auth/passkeys': failure('Could not load passkeys.') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not load passkeys.');
    const previous = globalThis.fetch;
    globalThis.fetch = mockFetch(read);
    try {
      await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
      await expect(
        await canvas.findByRole('button', { name: 'More actions for Laptop' }),
      ).toBeVisible();
      await expect(canvas.queryByRole('alert')).toBeNull();
      await expect(canvas.queryByRole('button', { name: 'Retry' })).toBeNull();
    } finally {
      globalThis.fetch = previous;
    }
  },
};
