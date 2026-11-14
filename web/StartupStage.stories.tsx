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
    await expect(within(canvasElement.ownerDocument.body).getByRole('status')).toHaveTextContent(
      'Still starting: sign-in check (9 s)',
    );
  },
} satisfies Meta<typeof StartupStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SlowStart: Story = {};
