import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { AdminPage } from './AdminPage.tsx';
import { Rail } from './Rail.tsx';
import { diagnosticsStory, healthStory } from './diagnosticsStoryData.ts';

const now = Date.UTC(2026, 9, 23, 12);
const key = { id: 'key', name: 'MacBook', provider: 'iCloud Keychain', createdAt: now - 86400_000, lastUsedAt: null };
const users = [
  { id: 'operator', name: 'Sam Rivera', isAdmin: true, disabled: false, passkeys: [key] },
  { id: 'alex', name: 'Alex Kim', isAdmin: false, disabled: false, passkeys: [{ ...key, id: 'alex-key' }] },
  { id: 'priya', name: 'Priya Patel — Research, planning and shared projects', isAdmin: false, disabled: true, passkeys: [] },
];
const api = {
  'GET /api/auth/admin/users': { users },
  'GET /api/auth/invites/recipients': { users: users.filter((user) => !user.disabled).map((user) => ({ ...user, isAdmin: Number(user.isAdmin) })) },
  'GET /api/auth/invites': { invites: [{ id: 'invite', expiresAt: now + 86400_000, recoveryName: null, usedBy: null, status: 'Available' }] },
  'POST /api/auth/invites': { url: 'https://spinel.example/invite#once-only-story-link' },
  'GET /api/auth/admin/connections': { connections: [{ id: 'connection', name: 'Desktop assistant', userName: 'Alex Kim', redirectOrigin: 'https://assistant.example', createdAt: now, lastUsedAt: null, revoked: false, scopes: [] }] },
  'GET /api/auth/admin/tokens': { tokens: [{ id: 'token', name: 'Personal script', userName: 'Alex Kim', createdAt: now, lastUsedAt: null, revoked: false }] },
  'GET /api/admin/backups': { configured: true, lastGood: now - 3600_000, lastAttempt: now - 3600_000, error: null, running: false, overdue: false },
  'GET /api/admin/health': healthStory,
  'GET /api/admin/diagnostics': diagnosticsStory,
};
function Preview({ section = 'people' }: { section?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previous = location.href;
    history.replaceState(history.state, '', `/admin#${section}`);
    setReady(true);
    return () => history.replaceState(history.state, '', previous);
  }, [section]);
  return <div className="workspace admin-workspace">
    <Rail user={{ isAdmin: true, name: 'Sam Rivera' }} compact navigation={{ allow: () => false }} onSignOut={fn()} />
    <div className="workspace-body"><main>{ready && <AdminPage currentId="operator" />}</main></div>
  </div>;
}
const meta = { id: 'admin-page', title: 'Current production/Admin/Administration', component: Preview, parameters: { shell: 'none' } } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const People: Story = { parameters: { api } };
export const Loading: Story = { parameters: { api: { ...api, 'GET /api/auth/admin/users': pending() } } };
export const Error: Story = { parameters: { api: { ...api, 'GET /api/auth/admin/users': failure('Could not load accounts.', 503) } } };
export const Empty: Story = { parameters: { api: { ...api, 'GET /api/auth/admin/users': { users: [] } } } };
export const Invites: Story = { args: { section: 'invites' }, parameters: { api } };
export const Connections: Story = { args: { section: 'connections' }, parameters: { api }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText('Desktop assistant')).toBeVisible();
  await userEvent.click(canvas.getByText('Personal access token activity'));
  await expect(await canvas.findByText('Personal script')).toBeVisible();
  await expect(canvas.queryByRole('textbox')).toBeNull();
  await expect(canvas.queryByRole('button', { name: /Create|Revoke|Disconnect/ })).toBeNull();
} };
export const Health: Story = { args: { section: 'health' }, parameters: { api } };
export const DiagnosticsDownloadBlocksNavigation: Story = { args: { section: 'health' }, parameters: { api: { ...api, 'POST /api/admin/diagnostics/download': pending() } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByRole('button', { name: 'Download diagnostics' })).toBeEnabled());
  await userEvent.click(canvas.getByRole('button', { name: 'Download diagnostics' }));
  const navigation = within(canvas.getByRole('navigation', { name: 'Administration sections' }));
  await expect(navigation.getByRole('link', { name: 'People' })).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(navigation.getByRole('link', { name: 'People' }));
  await expect(canvas.getByRole('heading', { name: 'Backups & health' })).toBeVisible();
  location.hash = 'people';
  await waitFor(() => expect(location.hash).toBe('#health'));
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel download' }));
  await expect(navigation.getByRole('link', { name: 'People' })).not.toHaveAttribute('aria-disabled');
} };
export const DiagnosticsClearBlocksNavigation: Story = { args: { section: 'health' }, parameters: { api: { ...api, 'POST /api/admin/diagnostics/truncate': pending() } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), body = within(document.body);
  await waitFor(() => expect(canvas.getByRole('button', { name: 'Download diagnostics' })).toBeEnabled());
  await userEvent.click(canvas.getByRole('button', { name: 'Diagnostics actions' }));
  await userEvent.click(await body.findByRole('menuitem', { name: 'Truncate diagnostics…' }));
  const dialog = await body.findByRole('dialog', { name: 'Truncate diagnostics' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Truncate diagnostics' }));
  await userEvent.keyboard('{Escape}');
  location.hash = 'people';
  await waitFor(() => expect(location.hash).toBe('#health'));
  await expect(dialog).toBeVisible();
} };
export const HealthWarning: Story = { args: { section: 'health' }, parameters: { api: { ...api, 'GET /api/admin/backups': { ...api['GET /api/admin/backups'], overdue: true, lastGood: now - 3 * 86400_000 } } } };
export const Phone: Story = { parameters: { api }, globals: { viewport: { value: 'phone', isRotated: false } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const nav = await canvas.findByRole('navigation', { name: 'Administration sections' });
  for (const link of within(nav).getAllByRole('link')) {
    await expect(link).toBeVisible();
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
} };
export const RecoveryHandoff: Story = { parameters: { api }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), body = within(document.body);
  await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Alex Kim' }));
  await userEvent.click(await body.findByRole('menuitem', { name: 'Create recovery invite…' }));
  const dialog = await body.findByRole('dialog', { name: 'Create invite' });
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Invite for' })).toBeEnabled());
  await expect(within(dialog).getByRole('combobox', { name: 'Invite for' })).toHaveValue('alex');
  await expect(within(dialog).getByText(/recovery replaces this account’s old passkeys/)).toBeVisible();
} };
export const OnceOnlyInvite: Story = { args: { section: 'invites' }, parameters: { api }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), body = within(document.body);
  const create = await canvas.findByRole('button', { name: 'Create invite' });
  await waitFor(() => expect(create).toBeEnabled());
  await userEvent.click(create);
  const dialog = await body.findByRole('dialog', { name: 'Create invite' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create invite' }));
  await expect(await canvas.findByRole('textbox', { name: 'New invite link' })).toHaveValue('https://spinel.example/invite#once-only-story-link');
  const nav = within(canvas.getByRole('navigation', { name: 'Administration sections' }));
  await userEvent.click(nav.getByRole('link', { name: 'People' }));
  await expect(await canvas.findByRole('heading', { name: 'People' })).toBeVisible();
  await userEvent.click(nav.getByRole('link', { name: 'Invites' }));
  await expect(await canvas.findByRole('list', { name: 'Invites' })).toBeVisible();
  await expect(canvas.queryByRole('textbox', { name: 'New invite link' })).toBeNull();
} };
export const CreatingInvite: Story = { args: { section: 'invites' }, parameters: { api: { ...api, 'POST /api/auth/invites': pending() } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), body = within(document.body);
  const create = await canvas.findByRole('button', { name: 'Create invite' });
  await waitFor(() => expect(create).toBeEnabled());
  await userEvent.click(create);
  const dialog = await body.findByRole('dialog', { name: 'Create invite' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create invite' }));
  await expect(within(dialog).getByRole('button', { name: 'Creating…' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  await expect(dialog).toBeVisible();
  location.hash = 'people';
  await waitFor(() => expect(location.hash).toBe('#invites'));
  await expect(dialog).toBeVisible();
} };
