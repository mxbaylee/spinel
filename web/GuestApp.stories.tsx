import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { GuestApp } from './GuestApp.tsx';

// GuestApp reads its item ID from the page path (/share/<id>) and its link
// token from the hash. replaceState changes both without navigating, so the
// iframe stays loaded, and the original URL comes back when the story unmounts.
const id = '00000000-0000-4000-8000-0000000000a1';
const guest = `GET /api/guest/${id}`;

function GuestLocation({
  token,
  noLocks,
  children,
}: {
  token?: string;
  noLocks?: boolean;
  children: ReactNode;
}) {
  const original = useRef<string | undefined>(undefined);
  original.current ??= `${location.pathname}${location.search}${location.hash}`;
  const target = `/share/${id}${token ? `#${token}` : ''}`;
  // Set during render because GuestApp reads the location when it first renders.
  if (`${location.pathname}${location.hash}` !== target) history.replaceState(null, '', target);
  // Hide Web Locks the same way, before GuestApp's first effect looks for them.
  if (noLocks && navigator.locks)
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  useEffect(
    () => () => {
      history.replaceState(null, '', original.current);
      if (noLocks) Reflect.deleteProperty(navigator, 'locks');
    },
    [noLocks],
  );
  return <>{children}</>;
}

function guestLocation(options: { token?: string; noLocks?: boolean } = {}): Decorator {
  return (Story) => (
    <GuestLocation {...options}>
      <Story />
    </GuestLocation>
  );
}

const meta = {
  id: 'guest-guestapp',
  title: 'Current production/Guest/GuestApp',
  component: GuestApp,
  // GuestApp renders its own <main>, so skip the dashboard shell.
  parameters: { shell: 'none' },
} satisfies Meta<typeof GuestApp>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Waiting for the server to answer; the editor loads only once an item arrives. */
export const Loading: Story = {
  decorators: [guestLocation()],
  parameters: { api: { [guest]: pending() } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Opening shared document…',
    );
  },
};
/** The link was revoked or replaced: any 401, 403 or 404 ends the page. */
export const LinkRevoked: Story = {
  decorators: [guestLocation()],
  parameters: { api: { [guest]: failure('Not found.', 404) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('This link no longer works.');
    await expect(canvas.getByText('Ask the person who shared it for a new link.')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
  },
};
/** A server error is treated as a dropped connection. The page keeps retrying every second. */
export const ConnectionInterrupted: Story = {
  decorators: [guestLocation()],
  parameters: { api: { [guest]: failure('Try again later.', 503) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(canvas.queryByText('Opening shared document…')).not.toBeInTheDocument();
  },
};
/** A link with a token needs Web Locks to open safely across tabs; without them the page stops. */
export const UnsupportedBrowser: Story = {
  decorators: [guestLocation({ token: 'story-token', noLocks: true })],
  parameters: { api: { [guest]: pending() } },
};
