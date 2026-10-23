import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import { ServerHealth } from './ServerHealth.tsx';
import { healthStory, healthStoryTime } from './diagnosticsStoryData.ts';

const meta = { title: 'Current production/Admin/ServerHealth', component: ServerHealth } satisfies Meta<typeof ServerHealth>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Healthy: Story = { parameters: { api: { 'GET /api/admin/health': healthStory } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText('No warning in this sample')).toBeVisible();
  await expect(canvas.getByText('Not configured')).toBeVisible();
  await expect(canvas.getByText('-1 MiB')).toBeVisible();
  await expect(canvas.getByText('Unavailable')).toBeVisible();
} };
export const Warning: Story = { parameters: { api: { 'GET /api/admin/health': { ...healthStory,
  memory: { ...healthStory.memory, systemUsedBytes: 1.8 * 1024 ** 3, aboveBudgetSince: healthStoryTime - 600_000 },
  storage: { ...healthStory.storage, freeBytes: 100 * 1024 ** 2, logicalDatabaseBytes: 4.2 * 1024 ** 3, backupStagingBytes: 9.1 * 1024 ** 3 },
  jobs: healthStory.jobs.map((job) => job.name === 'history-maintenance' ? { ...job, failedSince: healthStoryTime - 600_000 } : job),
} } } };
export const UnavailableMeasurements: Story = { parameters: { api: { 'GET /api/admin/health': { ...healthStory, application: null, diagnostics: null, memory: { ...healthStory.memory, systemMeasure: 'free', containerUsedBytes: null }, storage: { ...healthStory.storage, freeBytes: null, logicalDatabaseBytes: null, backupStagingBytes: null } } } } };
export const LowBackupSpace: Story = { parameters: { api: { 'GET /api/admin/health': { ...healthStory, storage: { ...healthStory.storage, freeBytes: 1 } } } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText('Needs attention')).toBeVisible();
  await expect(canvas.getByRole('alert')).toHaveTextContent('Free space is below the backup staging requirement.');
  await expect(canvas.queryByText('No warning in this sample')).not.toBeInTheDocument();
} };
export const NearUploadCeiling: Story = { parameters: { api: { 'GET /api/admin/health': { ...healthStory, storage: { ...healthStory.storage, logicalDatabaseBytes: healthStory.storage.backupUploadLimitBytes * 0.81 } } } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText('Needs attention')).toBeVisible();
  await expect(canvas.getByRole('alert')).toHaveTextContent('Check the encrypted archive size');
} };
export const Loading: Story = { parameters: { api: { 'GET /api/admin/health': pending() } } };
export const Failed: Story = { parameters: { api: { 'GET /api/admin/health': failure('Private server path must never appear', 503) } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole('alert')).toHaveTextContent('Server health is unavailable.');
  await expect(canvas.queryByText(/Private server path/)).not.toBeInTheDocument();
} };
export const Expired: Story = { parameters: { api: { 'GET /api/admin/health': failure('Private account details', 404) } } };
