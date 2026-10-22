import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ConnectionsReview } from './ConnectionsReview.tsx';
import './mockups.css';

const meta = {
  title: 'Redesign/Connections',
  component: ConnectionsReview,
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'Connection-list redesign covering every existing AssistantConnections state. No account APIs are called. Client names and return origins are supplied metadata; no device identity is inferred.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="sp-ui rd-dialog-stage">
        <div className="rd-dialog-example">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectionsReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loaded: Story = {};
export const Empty: Story = { args: { state: 'empty' } };
export const Loading: Story = { args: { state: 'loading' } };
export const LoadFailed: Story = { args: { state: 'load-failed' } };
export const Disconnecting: Story = { args: { state: 'disconnecting' } };
export const Disconnected: Story = { args: { state: 'disconnected' } };
export const DisconnectFailed: Story = { args: { state: 'disconnect-failed' } };
export const MatchingNames: Story = { args: { state: 'matching-names' } };
export const PreviouslyUsed: Story = { args: { state: 'previously-used' } };
export const OperatorMetadata: Story = {
  args: { admin: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
    await expect(canvas.queryByRole('button', { name: /^Disconnect / })).toBeNull();
    await expect(canvas.queryByRole('textbox', { name: 'MCP server address' })).toBeNull();
    await expect(canvas.getByText('Sam Rivera · Disconnected')).toBeVisible();
  },
};
export const OperatorEmpty: Story = { args: { admin: true, state: 'empty' } };
export const OperatorLoading: Story = { args: { admin: true, state: 'loading' } };
export const OperatorLoadFailed: Story = { args: { admin: true, state: 'load-failed' } };
export const RetryLoad: Story = {
  args: { state: 'load-failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not load');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByRole('list', { name: 'Assistant connections' })).toBeVisible();
  },
};
export const RetryDisconnect: Story = {
  args: { state: 'disconnect-failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A failed revoke must not tell a person that the client has lost access.
    await expect(canvas.getByText('Connected', { exact: true })).toBeVisible();
    await expect(canvas.getByRole('alert')).toHaveTextContent('It still has access.');
    await userEvent.click(canvas.getByRole('button', { name: /^Retry disconnecting / }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByText('Disconnected', { exact: true })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('in this preview');
  },
};
export const DisconnectMatchingClient: Story = {
  args: { state: 'matching-names' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Disconnect Desktop assistant from https://another-assistant.example',
      }),
    );
    const rows = canvas.getAllByRole('listitem');
    await expect(within(rows[0]).getByText('Connected', { exact: true })).toBeVisible();
    await expect(within(rows[1]).getByText('Disconnected', { exact: true })).toBeVisible();
  },
};
