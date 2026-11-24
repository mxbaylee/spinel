import { useEffect, useRef } from 'react';
import { showStartupFailure } from './startupFailure.ts';
import { offlineHtml } from './offlinePage.ts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within, waitFor } from 'storybook/test';
import { StartupScreen } from './StartupScreen.ts';
import { checkLoadingRunner } from '../../.storybook/loadingChecks.ts';

const meta = {
  title: 'Current production/Shell/Startup',
  component: StartupScreen,
  parameters: { shell: 'none' },
} satisfies Meta<typeof StartupScreen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('spinelLoading your workspace…');
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument();
    await checkLoadingRunner(canvasElement);
    await expect(
      getComputedStyle(canvasElement.querySelector('.sp-startup-gem')!).animationName,
    ).toBe('none');
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const WithinWorkspace: Story = { ...Loading, args: { contained: true } };

function FailedStartup() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) showStartupFailure(root.current);
  }, []);
  return (
    <div ref={root}>
      <StartupScreen />
    </div>
  );
}
export const Failed: Story = {
  render: () => <FailedStartup />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Spinel could not start.');
    await expect(canvas.getByText('spinel', { exact: true })).toBeVisible();
    await expect(canvasElement.querySelector('.rd-runner')).not.toBeVisible();
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument();
    await expect(
      getComputedStyle(canvasElement.querySelector('.sp-startup-gem')!).animationName,
    ).toBe('none');
  },
};
// This is the actual service-worker response; iframe isolation preserves its standalone CSS/CSP boundary.
export const OfflineEntry: Story = {
  render: () => (
    <iframe
      title="Installed offline entry"
      srcDoc={offlineHtml}
      style={{ width: '100%', height: '100dvh', border: 0 }}
    />
  ),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector('iframe')!;
    await waitFor(() =>
      expect(frame.contentDocument?.querySelector('h1')?.textContent).toBe("You're offline"),
    );
    const offline = within(frame.contentDocument!.body);
    await expect(offline.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(offline.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(offline.getByText('spinel', { exact: true })).toBeVisible();
  },
};
