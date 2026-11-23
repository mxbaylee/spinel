import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { createStartupLine } from './startupStage.ts';
import { EntryFrame } from './EntryFrame.tsx';

function StartupStatus({ stage = 'sign-in check' }: { stage?: string }) {
  useEffect(() => {
    const line = createStartupLine();
    line.textContent = `Still starting: ${stage} (9 s)`;
    document.body.append(line);
    return () => line.remove();
  }, [stage]);
  return null;
}

const meta = {
  title: 'Current production/Startup status',
  component: StartupStatus,
  parameters: { shell: 'none' },
  play: async ({ canvasElement, args }) => {
    // The production line is appended by a passive effect after the story mounts.
    const status = await within(canvasElement.ownerDocument.body).findByText(
      `Still starting: ${args.stage ?? 'sign-in check'} (9 s)`,
    );
    await expect(status).toHaveAttribute('role', 'status');
    const footer = canvasElement.querySelector('footer');
    if (args.stage === 'saved files') await expect(footer).not.toBeNull();
    if (footer)
      await expect(status.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        footer.getBoundingClientRect().top,
      );
  },
} satisfies Meta<typeof StartupStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SlowStart: Story = {};
export const SavedFiles: Story = {
  args: { stage: 'saved files' },
  render: (args) => (
    <>
      <EntryFrame
        title="Your workspace."
        intro="Sheets and Docs, together in a private place."
        onHome={fn()}
        footer="Have a shared link? Open it directly to view the document."
      >
        <p role="status">Loading…</p>
      </EntryFrame>
      <StartupStatus {...args} />
    </>
  ),
};
