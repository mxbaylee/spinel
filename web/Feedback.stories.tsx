import { StrictMode, useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import { Button } from '../src/ui/redesign/Controls.tsx';
import type { FeedbackSubmission } from '../src/shared/feedback.ts';
import { FeedbackDialog } from './Feedback.tsx';

const account = '11111111-1111-4111-8111-111111111111';
const generation = '22222222-2222-4222-8222-222222222222';
const boundary = {
  generation,
  binding: 'a'.repeat(64),
  maxMessageLength: 2000,
  maxMessageBytes: 8000,
};
const message = 'The sheet took a while to reconnect after I returned to this tab.';
type Scenario =
  'ready' | 'loading' | 'unavailable' | 'sending' | 'failed' | 'retry' | 'stale' | 'denied';

/** The actual composer, with a durable-ack fixture that echoes the submitted identity. */
function FeedbackFixture({ scenario = 'ready' }: { scenario?: Scenario }) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const original = globalThis.fetch;
    let first: FeedbackSubmission | undefined;
    let attempts = 0;
    const fixture: typeof fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      ).pathname;
      if (path === '/api/diagnostics/feedback-context') {
        if (scenario === 'loading') return new Promise<Response>(() => {});
        if (scenario === 'unavailable')
          return Response.json({ error: 'private storage detail' }, { status: 503 });
        return Response.json(boundary);
      }
      if (path === '/api/diagnostics/feedback') {
        const body = JSON.parse(String(init?.body)) as FeedbackSubmission;
        attempts++;
        first ??= body;
        if (scenario === 'sending') return new Promise<Response>(() => {});
        if (scenario === 'failed' || (scenario === 'retry' && attempts === 1))
          throw new TypeError('Response lost after persistence');
        if (scenario === 'stale') return Response.json({ error: 'changed' }, { status: 409 });
        if (scenario === 'denied')
          return Response.json({ error: 'private identity' }, { status: 403 });
        // Retry proves the whole immutable payload, not merely the request ID.
        if (JSON.stringify(first) !== JSON.stringify(body))
          throw new Error('Retry changed report.');
        return Response.json({ id: body.id, generation: body.generation, receivedAt: Date.now() });
      }
      return original(input, init);
    };
    globalThis.fetch = fixture;
    setReady(true);
    return () => {
      if (globalThis.fetch === fixture) globalThis.fetch = original;
    };
  }, [scenario]);
  return (
    <>
      <Button ref={trigger} onClick={() => setOpen(true)}>
        Open feedback
      </Button>
      {ready && (
        <StrictMode>
          <FeedbackDialog
            accountId={account}
            open={open}
            pageContext={{ route: '/files/:id', fileId: '33333333-3333-4333-8333-333333333333' }}
            onOpenChange={setOpen}
            finalFocus={() => trigger.current}
          />
        </StrictMode>
      )}
    </>
  );
}

async function compose() {
  const dialog = await within(document.body).findByRole('dialog', { name: 'Send feedback' });
  const content = within(dialog);
  await userEvent.type(content.getByRole('textbox', { name: /^Message$/ }), message);
  await waitFor(() => expect(content.getByRole('button', { name: 'Send feedback' })).toBeEnabled());
  return content;
}
async function submit() {
  const content = await compose();
  await userEvent.click(content.getByRole('button', { name: 'Send feedback' }));
  return content;
}
const meta = {
  title: 'Current production/Account/Feedback',
  component: FeedbackFixture,
  args: { scenario: 'ready' },
} satisfies Meta<typeof FeedbackFixture>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Send feedback' });
    await expect(within(dialog).getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    await assertDialogControls(dialog);
  },
};
export const Draft: Story = {
  play: async () => {
    await compose();
  },
};
export const Loading: Story = {
  args: { scenario: 'loading' },
  play: async () => {
    await expect(await within(document.body).findByText('Connecting feedback…')).toBeVisible();
  },
};
export const Unavailable: Story = {
  args: { scenario: 'unavailable' },
  play: async () => {
    await expect(await within(document.body).findByRole('alert')).toHaveTextContent(
      'Feedback is unavailable',
    );
    await expect(
      within(document.body).queryByText('private storage detail'),
    ).not.toBeInTheDocument();
  },
};
export const Sending: Story = {
  args: { scenario: 'sending' },
  play: async () => {
    const content = await submit();
    await expect(await content.findByText('Sending feedback…')).toBeVisible();
    await expect(content.getByRole('button', { name: 'Retry feedback' })).toBeDisabled();
  },
};
export const FailedDraft: Story = {
  args: { scenario: 'failed' },
  play: async () => {
    const content = await submit();
    await expect(await content.findByRole('alert')).toHaveTextContent(
      'Sending could not be confirmed',
    );
    await expect(content.getByRole('textbox', { name: 'Message' })).toHaveValue(message);
    await expect(content.getByRole('textbox', { name: 'Message' })).toHaveAttribute('readonly');
  },
};
export const RetryConfirmed: Story = {
  args: { scenario: 'retry' },
  play: async () => {
    const content = await submit();
    await expect(await content.findByRole('alert')).toHaveTextContent(
      'Sending could not be confirmed',
    );
    await userEvent.click(content.getByRole('button', { name: 'Retry feedback' }));
    await expect(
      await content.findByText('Feedback saved. Thank you for reporting it.'),
    ).toBeVisible();
  },
};
export const Saved: Story = {
  play: async () => {
    const content = await submit();
    await expect(
      await content.findByText('Feedback saved. Thank you for reporting it.'),
    ).toBeVisible();
    await expect(content.queryByRole('textbox')).not.toBeInTheDocument();
  },
};
export const CollectionChanged: Story = {
  args: { scenario: 'stale' },
  play: async () => {
    const content = await submit();
    await expect(await content.findByRole('alert')).toHaveTextContent(
      'will not be sent again automatically',
    );
    await expect(content.getByRole('textbox', { name: 'Message' })).toHaveValue(message);
    await userEvent.click(content.getByRole('button', { name: 'Start a new report' }));
    await waitFor(() =>
      expect(content.getByRole('button', { name: 'Send feedback' })).toBeEnabled(),
    );
    await expect(content.getByRole('textbox', { name: 'Message' })).not.toHaveAttribute('readonly');
  },
};
export const StaleReport: Story = {
  args: { scenario: 'stale' },
  play: async () => {
    const content = await submit();
    await expect(await content.findByRole('alert')).toHaveTextContent(
      'Diagnostics or your session changed',
    );
  },
};
export const AccessChanged: Story = {
  args: { scenario: 'denied' },
  play: async () => {
    const content = await submit();
    await expect(await content.findByRole('alert')).toHaveTextContent(
      'Your account or page access changed',
    );
    await expect(content.getByRole('button', { name: 'Retry feedback' })).toBeDisabled();
  },
};
export const CancelledSend: Story = {
  args: { scenario: 'sending' },
  play: async () => {
    const content = await submit();
    await userEvent.click(await content.findByRole('button', { name: 'Stop sending' }));
    await expect(content.getByRole('alert')).toHaveTextContent(
      'may already have reached the Operator',
    );
    await expect(content.getByRole('button', { name: 'Retry feedback' })).toBeEnabled();
    await expect(content.getByRole('textbox', { name: 'Message' })).toHaveValue(message);
  },
};
export const DismissedDraft: Story = {
  play: async ({ canvasElement }) => {
    const content = await compose();
    await userEvent.click(content.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument(),
    );
    const trigger = within(canvasElement).getByRole('button', { name: 'Open feedback' });
    await expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    const dialog = await within(document.body).findByRole('dialog', { name: 'Send feedback' });
    await expect(within(dialog).getByRole('textbox', { name: 'Message' })).toHaveValue(message);
  },
};
