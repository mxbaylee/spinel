import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { createStartupLine } from './startupStage.ts';

function StartupStatus() {
  useEffect(() => {
    const line = createStartupLine();
    line.textContent = 'Still starting: sign-in check (9 s)';
    document.body.append(line);
    return () => line.remove();
  }, []);
  return null;
}

const meta = {
  title: 'Current production/Startup status',
  component: StartupStatus,
  parameters: { shell: 'none' },
  play: async ({ canvasElement }) => {
    // The production line is appended by a passive effect after the story mounts.
    const status = await within(canvasElement.ownerDocument.body).findByRole('status');
    await expect(status).toHaveTextContent('Still starting: sign-in check (9 s)');
  },
} satisfies Meta<typeof StartupStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SlowStart: Story = {};
