import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';
import { assertDialogControls } from '../.storybook/dialogBounds.ts';
import type { MaintenanceAdminStatus } from '../src/shared/maintenance.ts';
import { MaintenanceBanner, MaintenanceControls } from './Maintenance.tsx';
import { maintenanceInstants } from './maintenanceTime.ts';

type Scenario =
  | 'running'
  | 'paused'
  | 'draining'
  | 'starting'
  | 'recovery'
  | 'expired'
  | 'unavailable'
  | 'loading'
  | 'failed'
  | 'scheduled'
  | 'missed'
  | 'lost-response';
const epoch = 'bdcb9545-e87d-44c6-8717-397523f7efb3';
const operationId = '78758a8a-db2e-4d92-9bf4-8c0b9cac66f8';

function nextRepeatedTime() {
  const now = Date.now(),
    year = new Date(now).getUTCFullYear();
  const candidates: Array<{ localTime: string; timeZone: string; startsAt: number }> = [];
  for (const candidateYear of [year, year + 1]) {
    for (const [month, hour, timeZone] of [
      [10, '01', 'America/Los_Angeles'],
      [3, '02', 'Australia/Sydney'],
    ] as const) {
      const first = new Date(Date.UTC(candidateYear, month, 1));
      const day = 1 + ((7 - first.getUTCDay()) % 7);
      const localTime = `${candidateYear}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour}:30`;
      const instants = maintenanceInstants(localTime, timeZone);
      if (instants.length === 2 && instants[1] > now && instants[1] < now + 365 * 86_400_000)
        candidates.push({ localTime, timeZone, startsAt: instants[1] });
    }
  }
  const next = candidates.sort((a, b) => a.startsAt - b.startsAt)[0];
  if (!next) throw new Error('No repeated time inside the notice horizon.');
  return next;
}

function initialStatus(scenario: Scenario): MaintenanceAdminStatus {
  const paused = ['paused', 'draining', 'starting', 'recovery', 'expired'].includes(scenario);
  return {
    available: scenario !== 'unavailable',
    phase:
      scenario === 'recovery'
        ? 'recovery-required'
        : scenario === 'draining' || scenario === 'starting'
          ? scenario
          : paused
            ? 'paused'
            : 'running',
    epoch,
    notice: ['scheduled', 'missed', 'expired'].includes(scenario)
      ? {
          id: operationId,
          startsAt: Date.now() + (scenario === 'missed' ? -3_600_000 : 86_400_000),
          timeZone: 'America/Los_Angeles',
          durationMinutes: 30,
          state: scenario === 'missed' ? 'missed' : 'scheduled',
        }
      : null,
    operationId: paused ? operationId : null,
    authorityExpiresAt: paused ? Date.now() + (scenario === 'expired' ? -60_000 : 300_000) : null,
    generationId: 'fixture-generation',
    lastFailure: scenario === 'recovery' ? 'drain-failed' : null,
    readyToResume:
      paused && scenario !== 'draining' && scenario !== 'starting' && scenario !== 'expired',
  };
}

/** Real controls with local lifecycle fixtures; real authorization/process checks live in E2E. */
function Preview({
  scenario = 'running',
  onAction,
  onBusyChange,
}: {
  scenario?: Scenario;
  onAction: (action: string, body: unknown) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(() => initialStatus(scenario));
  useEffect(() => {
    const original = globalThis.fetch;
    let status = initialStatus(scenario);
    let verifiedUntil = 0;
    const fixture: typeof fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      ).pathname;
      if (path === '/api/maintenance') return Response.json(status);
      if (path === '/api/admin/maintenance') {
        if (scenario === 'loading') return new Promise<Response>(() => {});
        if (scenario === 'failed')
          return Response.json({ error: 'Private fixture diagnostic' }, { status: 503 });
        return Response.json({ status });
      }
      // Authentication writes are gated in the real app during maintenance.
      if (path.startsWith('/api/auth/reauthentication/') && status.phase !== 'running')
        return Response.json({ error: 'Workspace maintenance' }, { status: 503 });
      if (path === '/api/auth/reauthentication/options')
        return Response.json({ options: { challenge: 'fixture' }, challengeId: 'a'.repeat(43) });
      if (path === '/api/auth/reauthentication/verify') {
        verifiedUntil = Date.now() + 300_000;
        return Response.json({ verifiedUntil });
      }
      if (path === '/api/auth/cancel') return Response.json({});
      if (path.startsWith('/api/admin/maintenance/') && init?.method === 'POST') {
        const action = path.split('/').at(-1)!;
        const body = JSON.parse(String(init.body));
        onAction(action, body);
        if (new Headers(init.headers).get('X-Spinel-Account') !== 'operator')
          return Response.json({ error: 'Account changed' }, { status: 409 });
        if (
          action !== 'resume' &&
          (body.intentExpiresAt !== verifiedUntil || verifiedUntil <= Date.now())
        )
          return Response.json(
            { error: 'Verify the exact maintenance intent again' },
            { status: 403 },
          );
        if (action === 'pause') {
          status = {
            ...status,
            phase: 'paused',
            epoch: 'e47c6414-cb83-41a4-9ea3-3c5555c5433a',
            operationId: body.operationId,
            authorityExpiresAt: Date.now() + 300_000,
            readyToResume: true,
          };
          setVisible(status);
          if (scenario === 'lost-response') throw new TypeError('Simulated response loss');
          return Response.json({ status, resumeToken: 'fixture-memory-only-resume-authority' });
        }
        if (action === 'resume') {
          if (
            body.operationId !== status.operationId ||
            body.resumeToken !== 'fixture-memory-only-resume-authority'
          )
            return Response.json({ error: 'Invalid authority' }, { status: 403 });
          status = {
            ...status,
            phase: 'running',
            operationId: null,
            authorityExpiresAt: null,
            readyToResume: false,
          };
        }
        if (action === 'notice')
          status = {
            ...status,
            notice: {
              id: body.id,
              startsAt: body.startsAt,
              durationMinutes: body.durationMinutes,
              timeZone: body.timeZone,
              state: 'scheduled',
            },
          };
        if (action === 'cancel-notice' && status.notice)
          status = { ...status, notice: { ...status.notice, state: 'cancelled' } };
        setVisible(status);
        return Response.json({ status });
      }
      return Response.json({ error: 'Missing fixture' }, { status: 404 });
    };
    globalThis.fetch = fixture;
    setReady(true);
    return () => {
      if (globalThis.fetch === fixture) globalThis.fetch = original;
    };
  }, [scenario, onAction]);
  return (
    <div className="maintenance-story">
      <MaintenanceBanner status={visible} />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
        {ready && (
          <MaintenanceControls
            currentId="operator"
            onBusyChange={onBusyChange}
            authenticate={async () => ({
              id: 'operator-key',
              rawId: 'operator-key',
              type: 'public-key',
              response: {
                authenticatorData: 'fixture',
                clientDataJSON: 'fixture',
                signature: 'fixture',
              },
              clientExtensionResults: {},
            })}
          />
        )}
      </div>
    </div>
  );
}

const meta = {
  id: 'maintenance-controls',
  title: 'Current production/Admin/Maintenance',
  component: Preview,
  args: { onAction: fn(), onBusyChange: fn() },
  parameters: { shell: 'none' },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Edits enabled')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Pause edits' })).toBeEnabled();
  },
};
export const Scheduled: Story = { args: { scenario: 'scheduled' } };
export const MissedWindow: Story = { args: { scenario: 'missed' } };
export const Paused: Story = {
  args: { scenario: 'paused' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Resume' })).toBeDisabled();
    await expect(canvas.getByText(/Resume permission is unavailable in this tab/)).toBeVisible();
  },
};
export const Draining: Story = { args: { scenario: 'draining' } };
export const Starting: Story = { args: { scenario: 'starting' } };
export const RecoveryRequired: Story = { args: { scenario: 'recovery' } };
export const AuthorityExpired: Story = { args: { scenario: 'expired' } };
export const Unavailable: Story = { args: { scenario: 'unavailable' } };
export const Loading: Story = { args: { scenario: 'loading' } };
export const LoadFailed: Story = {
  args: { scenario: 'failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Maintenance status could not be checked',
    );
    await expect(canvas.queryByText('Private fixture diagnostic')).toBeNull();
  },
};

async function pauseDialog(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const pause = await canvas.findByRole('button', { name: 'Pause edits' });
  await waitFor(() => expect(pause).toBeEnabled());
  await userEvent.click(pause);
  return within(
    await within(document.body).findByRole('dialog', { name: 'Pause workspace edits?' }),
  );
}

export const ConfirmPause: Story = {
  play: async ({ canvasElement }) => {
    await pauseDialog(canvasElement);
  },
};
export const PauseAndResume: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const dialog = await pauseDialog(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await expect(await dialog.findByRole('status')).toHaveTextContent('Passkey verified');
    await expect(args.onAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Pause edits' }));
    await expect(
      await canvas.findByText('Edits paused. Accepted work has finished.'),
    ).toBeVisible();
    await expect(canvas.getByText(/Keep this page open to resume before/)).toBeVisible();
    await expect(args.onBusyChange).toHaveBeenLastCalledWith(true);
    await expect(canvas.getByRole('button', { name: 'Resume' })).toBeEnabled();
    await expect(canvas.queryByText('fixture-memory-only-resume-authority')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Resume' }));
    await expect(await canvas.findByText(/Edits resumed\./)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Reload Administration' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'Pause edits' })).toBeNull();
    await expect(args.onBusyChange).toHaveBeenLastCalledWith(false);
    await expect(args.onAction).toHaveBeenCalledTimes(2);
  },
};
export const PausedWithResume: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await pauseDialog(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await userEvent.click(await dialog.findByRole('button', { name: 'Pause edits' }));
    await expect(
      await within(canvasElement).findByRole('button', { name: 'Resume' }),
    ).toBeEnabled();
  },
};
export const PauseResponseLost: Story = {
  args: { scenario: 'lost-response' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await pauseDialog(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await userEvent.click(await dialog.findByRole('button', { name: 'Pause edits' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'request could not be confirmed',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh maintenance' }));
    await expect(await canvas.findByRole('button', { name: 'Resume' })).toBeDisabled();
    await expect(canvas.getByText(/Use the server recovery controls/)).toBeVisible();
  },
};
export const CancelConfirmation: Story = {
  play: async ({ canvasElement, args }) => {
    await pauseDialog(canvasElement);
    await userEvent.keyboard('{Escape}');
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
    await expect(args.onAction).not.toHaveBeenCalled();
    await expect(within(canvasElement).getByRole('button', { name: 'Pause edits' })).toHaveFocus();
  },
};

async function noticeDialog(canvasElement: HTMLElement) {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: 'Maintenance actions' }),
  );
  const body = within(document.body);
  await userEvent.click(await body.findByRole('menuitem', { name: 'Schedule a notice…' }));
  return within(await body.findByRole('dialog', { name: 'Schedule a maintenance notice' }));
}
export const NoticeForm: Story = {
  play: async ({ canvasElement }) => {
    await noticeDialog(canvasElement);
  },
};
export const RepeatedTime: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await noticeDialog(canvasElement);
    const repeated = nextRepeatedTime();
    const date = dialog.getByLabelText('Date and time');
    fireEvent.change(date, { target: { value: repeated.localTime } });
    const zone = dialog.getByLabelText('Time zone');
    await userEvent.clear(zone);
    await userEvent.type(zone, repeated.timeZone);
    await expect(await dialog.findByLabelText('This time occurs twice')).toHaveValue('');
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await expect(await dialog.findByRole('button', { name: 'Publish notice' })).toBeDisabled();
  },
};
export const PublishNotice: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await noticeDialog(canvasElement);
    const repeated = nextRepeatedTime();
    fireEvent.change(dialog.getByLabelText('Date and time'), {
      target: { value: repeated.localTime },
    });
    fireEvent.change(dialog.getByLabelText('Time zone'), {
      target: { value: repeated.timeZone },
    });
    await userEvent.selectOptions(
      await dialog.findByLabelText('This time occurs twice'),
      String(repeated.startsAt),
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await userEvent.click(await dialog.findByRole('button', { name: 'Publish notice' }));
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Maintenance notice published/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Pause edits' })).toBeEnabled();
    await expect(args.onAction).toHaveBeenCalledTimes(1);
    await expect(args.onAction).toHaveBeenCalledWith(
      'notice',
      expect.objectContaining({
        startsAt: repeated.startsAt,
        timeZone: repeated.timeZone,
        durationMinutes: 30,
      }),
    );
  },
};
export const NoticeTooFarAhead: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await noticeDialog(canvasElement);
    fireEvent.change(dialog.getByLabelText('Time zone'), { target: { value: 'UTC' } });
    fireEvent.change(dialog.getByLabelText('Date and time'), {
      target: { value: new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 16) },
    });
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Choose a start time within the next 365 days.',
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await expect(await dialog.findByRole('button', { name: 'Publish notice' })).toBeDisabled();
    await expect(args.onAction).not.toHaveBeenCalled();
  },
};
export const CancelNotice: Story = {
  args: { scenario: 'scheduled' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement),
      body = within(document.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Maintenance actions' }));
    await userEvent.click(
      await body.findByRole('menuitem', { name: 'Cancel maintenance notice…' }),
    );
    const dialog = within(await body.findByRole('dialog', { name: 'Cancel maintenance notice?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Verify with a passkey' }));
    await userEvent.click(await dialog.findByRole('button', { name: 'Cancel notice' }));
    await expect(await canvas.findByText(/Maintenance notice cancelled/)).toBeVisible();
    await expect(args.onAction).toHaveBeenCalledWith(
      'cancel-notice',
      expect.objectContaining({ noticeId: operationId }),
    );
    await expect(canvas.queryByRole('region', { name: 'Workspace maintenance' })).toBeNull();
  },
};
export const CancelNoticeWhilePaused: Story = {
  args: { scenario: 'scheduled' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement),
      body = within(document.body);
    // This tab pauses, so it holds the resume capability the cancel must keep.
    const pause = await pauseDialog(canvasElement);
    await userEvent.click(pause.getByRole('button', { name: 'Verify with a passkey' }));
    await userEvent.click(await pause.findByRole('button', { name: 'Pause edits' }));
    await expect(await canvas.findByRole('button', { name: 'Resume' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Maintenance actions' }));
    // Replacing a notice waits for running; withdrawing a stale one does not.
    await expect(
      await body.findByRole('menuitem', { name: 'Replace maintenance notice…' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(body.getByRole('menuitem', { name: 'Cancel maintenance notice…' }));
    const dialog = within(await body.findByRole('dialog', { name: 'Cancel maintenance notice?' }));
    await expect(dialog.queryByRole('button', { name: 'Verify with a passkey' })).toBeNull();
    await userEvent.click(await dialog.findByRole('button', { name: 'Cancel notice' }));
    await expect(await canvas.findByText(/Maintenance notice cancelled/)).toBeVisible();
    await expect(args.onAction).toHaveBeenCalledWith(
      'cancel-notice',
      expect.objectContaining({ noticeId: operationId }),
    );
    // The pause is untouched and this tab can still resume it.
    await expect(canvas.getByRole('button', { name: 'Resume' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Resume' }));
    await expect(args.onAction).toHaveBeenCalledWith(
      'resume',
      expect.objectContaining({ resumeToken: 'fixture-memory-only-resume-authority' }),
    );
  },
};
export const CancelNoticeWithoutPausedProof: Story = {
  args: { scenario: 'expired' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement),
      body = within(document.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Maintenance actions' }));
    await userEvent.click(
      await body.findByRole('menuitem', { name: 'Cancel maintenance notice…' }),
    );
    const dialog = within(await body.findByRole('dialog', { name: 'Cancel maintenance notice?' }));
    await expect(dialog.getByText(/Passkey verification cannot be renewed/)).toBeVisible();
    await expect(dialog.queryByRole('button', { name: 'Verify with a passkey' })).toBeNull();
    await expect(dialog.queryByRole('button', { name: 'Cancel notice', exact: true })).toBeNull();
    await expect(args.onAction).not.toHaveBeenCalled();
  },
};
export const Phone: Story = {
  args: { scenario: 'scheduled' },
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Pause edits' })).toBeVisible();
    // The direct-iframe review runs this story at every partition's viewport.
    // Keep 44px targets on touch/phone and 36px controls on desktop, as in the app.
    await assertDialogControls(canvasElement);
  },
};
