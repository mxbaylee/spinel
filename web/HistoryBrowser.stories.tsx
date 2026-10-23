import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { getDocsEmptySnapshot } from '@univerjs/core';
import { failure, pending } from '../.storybook/api.ts';
import { HistoryBrowser } from './HistoryBrowser.tsx';
import type { HistoryVersion } from '../src/shared/historyNavigation.ts';

const itemId = '00000000-0000-4000-8000-000000000085';
const endpoint = `/api/items/${itemId}/history`;
const now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const versions: HistoryVersion[] = [
  { id: 'today-a', capturedAt: today + 9 * 3600000, name: 'Ready for review', beforeRestore: false },
  { id: 'today-b', capturedAt: today + 11 * 3600000, name: null, beforeRestore: true },
  { id: 'older-a', capturedAt: today - 86400000 + 10 * 3600000, name: 'Approved plan', beforeRestore: false },
  { id: 'older-b', capturedAt: today - 86400000 + 11 * 3600000, name: 'Before the budget revision', beforeRestore: true },
];
const snapshot = getDocsEmptySnapshot(itemId);
snapshot.body = {
  dataStream: 'A saved plan\r\n',
  paragraphs: [{ startIndex: 12 }],
};
const item = {
  id: itemId, kind: 'doc', name: 'Weekend plans', parentId: null,
  createdAt: today, updatedAt: today, tags: [], access: 'owner',
};
function api({ viewer = false, preview, restore }: { viewer?: boolean; preview?: unknown; restore?: unknown } = {}) {
  return {
    [`GET ${endpoint}`]: { versions, canName: !viewer },
    ...Object.fromEntries(versions.map((version) => [
      `GET ${endpoint}/${version.id}`,
      preview ?? { snapshot, item: { ...item, access: viewer ? 'viewer' : 'owner' }, unitId: 'current-generation' },
    ])),
    [`POST ${endpoint}`]: failure('Could not save this version name. Try again.', 503),
    ...Object.fromEntries(versions.map((version) => [
      `POST ${endpoint}/${version.id}/restore`,
      restore ?? failure('Could not restore this version. Try again.', 503),
    ])),
  };
}
/** Real isolated native preview. Only the account API responses are fixtures. */
function Fixture({ checkpoint = 'today-a' }: { checkpoint?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const original = { href: location.href, state: history.state };
    const href = new URL(location.href);
    href.searchParams.set('item', itemId);
    href.searchParams.set('version', checkpoint);
    history.replaceState(null, '', href);
    setMounted(true);
    return () => history.replaceState(original.state, '', original.href);
  }, [checkpoint]);
  return <div className="workspace profile-workspace history-workspace"><div className="workspace-body"><main>{mounted && <HistoryBrowser />}</main></div></div>;
}
const meta = {
  id: 'history-browser',
  title: 'Current production/History/Browser',
  component: Fixture,
  parameters: { layout: 'fullscreen', shell: 'none' },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;

async function ready(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole('button', { name: 'Restore this version' }, { timeout: 30000 })).toBeEnabled();
  await expect(await canvas.findByRole('button', { name: 'Bold' })).toBeDisabled();
  return canvas;
}
async function choose(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  if (window.innerWidth <= 900) await userEvent.click(canvas.getByRole('button', { name: /^Choose version/ }));
  return canvas;
}
async function bounds(canvasElement: HTMLElement) {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  for (const control of canvasElement.querySelectorAll<HTMLElement>('.history-heading button, .history-choices button, .history-disclosure')) {
    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    await expect(rect.left).toBeGreaterThanOrEqual(0);
    await expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1);
    await expect(rect.height).toBeGreaterThanOrEqual(44);
  }
}
export const Today: Story = {
  parameters: { api: api() },
  play: async ({ canvasElement }) => { await ready(canvasElement); await bounds(canvasElement); },
};
export const Dark: Story = { ...Today, globals: { theme: 'dark' } };
export const Phone: Story = {
  ...Today,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    if (window.innerWidth <= 900) {
      await expect(canvas.getByRole('button', { name: /^Choose version/ })).toHaveAttribute('aria-expanded', 'false');
      await expect(canvasElement.querySelector('.history-selection')).toHaveTextContent('Selected');
    }
    await bounds(canvasElement);
  },
};
export const Calendar: Story = {
  args: { checkpoint: 'older-b' }, parameters: { api: api() },
  play: async ({ canvasElement }) => {
    await ready(canvasElement);
    const canvas = await choose(canvasElement);
    await expect(canvas.getByRole('combobox', { name: /^Version on/ }).querySelectorAll('option')).toHaveLength(2);
    await expect(canvas.getByRole('list', { name: 'Retained checkpoints' })).toHaveTextContent('Before restore');
    await bounds(canvasElement);
  },
};
export const Loading: Story = { parameters: { api: { [`GET ${endpoint}`]: pending() } } };
export const Empty: Story = {
  args: { checkpoint: '' },
  parameters: { api: { [`GET ${endpoint}`]: { versions: [], canName: true } } },
};
export const Unavailable: Story = {
  parameters: { api: { [`GET ${endpoint}`]: failure('This document is unavailable.', 403) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('This document is unavailable.');
    await expect(canvas.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Name current version…' })).toBeNull();
  },
};
export const MissingCheckpoint: Story = {
  args: { checkpoint: 'not-retained' }, parameters: { api: api() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('no longer available');
    await expect(canvas.queryByRole('button', { name: 'Restore this version' })).toBeNull();
  },
};
export const PreviewLoading: Story = { parameters: { api: api({ preview: pending() }) } };
export const PreviewFailure: Story = {
  parameters: { api: api({ preview: failure('Could not open this version. Try again.', 503) }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Try again' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not open this version.');
  },
};
export const Viewer: Story = {
  parameters: { api: api({ viewer: true }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Bold' }, { timeout: 30000 })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: 'Restore this version' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Name current version…' })).toBeNull();
    await bounds(canvasElement);
  },
};
export const NameCurrent: Story = {
  parameters: { api: api({ preview: pending() }) },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Name current version…' }));
    const dialog = await within(document.body).findByRole('dialog', { name: 'Name current version' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Version name' }), 'Approved plan');
  },
};
export const NameFailure: Story = {
  ...NameCurrent,
  play: async (context) => {
    await NameCurrent.play!(context);
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Name current version' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save version name' }));
    await expect(await dialog.findByRole('alert')).toHaveTextContent('Could not save');
    await expect(dialog.getByRole('textbox', { name: 'Version name' })).toHaveValue('Approved plan');
  },
};
export const RestoreConfirmation: Story = {
  parameters: { api: api() },
  play: async ({ canvasElement }) => {
    const canvas = await ready(canvasElement);
    const button = canvas.getByRole('button', { name: 'Restore this version' });
    await userEvent.click(button);
    const body = within(document.body);
    let dialog = within(await body.findByRole('dialog', { name: /Restore .*Ready for review.*for everyone\?/ }));
    await expect(dialog.getByText(/Before restore checkpoint/)).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await expect(button).toHaveFocus();
    await userEvent.click(button);
    dialog = within(await body.findByRole('dialog', { name: /Restore .*for everyone\?/ }));
    await expect(dialog.getByRole('button', { name: 'Restore version' })).toBeEnabled();
  },
};
export const RestoreFailure: Story = {
  ...RestoreConfirmation,
  play: async (context) => {
    await RestoreConfirmation.play!(context);
    const dialog = within(await within(document.body).findByRole('dialog', { name: /Restore .*for everyone\?/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Restore version' }));
    await expect(await dialog.findByRole('alert')).toHaveTextContent('Could not restore');
    await expect(dialog.getByRole('button', { name: 'Restore version' })).toBeEnabled();
  },
};
export const RestoreInterrupted: Story = {
  ...RestoreConfirmation,
  parameters: { api: api({ restore: failure('Restore was interrupted. Start a new restore.', 409) }) },
  play: async (context) => {
    await RestoreConfirmation.play!(context);
    const dialog = within(await within(document.body).findByRole('dialog', { name: /Restore .*for everyone\?/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Restore version' }));
    await expect(await dialog.findByRole('button', { name: 'Reload preview for a new attempt' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Restore version' })).toBeDisabled();
  },
};
export const Restoring: Story = {
  ...RestoreConfirmation,
  parameters: { api: api({ restore: pending() }) },
  play: async (context) => {
    await RestoreConfirmation.play!(context);
    const dialog = within(await within(document.body).findByRole('dialog', { name: /Restore .*for everyone\?/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Restore version' }));
    await expect(dialog.getByRole('button', { name: 'Restoring…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(dialog.getByRole('button', { name: 'Restoring…' })).toBeVisible();
  },
};
