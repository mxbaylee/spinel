import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import type { FileItem, GrantRole, SharePerson } from '../src/shared/workspace.ts';
import type { SourceSharingReview, SourceSharingTarget } from '../src/shared/sourceSharing.ts';
import { Sharing } from './Sharing.tsx';

const report: FileItem = {
  access: 'owner',
  id: '00000000-0000-4000-8000-000000000076',
  parentId: null,
  kind: 'doc',
  name: 'Autumn report',
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 27),
  tags: [],
};
const recipient: SharePerson = {
  id: 'avery',
  name: 'Avery Chen',
  disabled: 0,
  directRole: 'viewer',
  effectiveRole: 'viewer',
};
const budget: SourceSharingTarget = {
  id: 'budget',
  name: 'Household budget',
  kind: 'sheet',
  sources: [{ id: 'budget', name: 'Household budget' }],
  state: 'grant',
  access: null,
};
const forecast: SourceSharingTarget = {
  id: 'forecast',
  name: 'Forecast',
  kind: 'sheet',
  sources: [{ id: 'forecast', name: 'Forecast' }],
  state: 'kept',
  access: 'editor',
};
type Scenario =
  | 'ordinary'
  | 'new-recipient'
  | 'pending-review'
  | 'failed-review'
  | 'pending-write'
  | 'already-shared'
  | 'same-space'
  | 'external-space'
  | 'restricted'
  | 'partial'
  | 'changed'
  | 'uncertain'
  | 'missing-result'
  | 'revoked'
  | 'source-revoked'
  | 'redacted-after-save';

/** Stateful responses exercise the production dialog, not the server. The
 * corresponding HTTP and browser tests verify real grants and formula access. */
function SourceScenario({ scenario = 'ordinary' }: { scenario?: Scenario }) {
  const [ready, setReady] = useState(false);
  const [payloads, setPayloads] = useState<unknown[]>([]);
  useEffect(() => {
    const previous = globalThis.fetch;
    let person: SharePerson = {
      ...recipient,
      ...(scenario === 'new-recipient' ? { directRole: null, effectiveRole: null } : {}),
    };
    let sourceShared = scenario === 'already-shared';
    let changed = false;
    let revoked = false;
    let attempts = 0;
    let linkEnabled = false;
    const review = (role: GrantRole | null): SourceSharingReview => {
      let targets: SourceSharingTarget[] = [
        {
          ...budget,
          name: changed ? 'Household budget · revised' : budget.name,
          state: sourceShared ? 'kept' : 'grant',
          access: sourceShared ? 'viewer' : null,
        },
        forecast,
      ];
      if (scenario === 'same-space') targets = [{ ...budget, state: 'included', access: role }];
      if (scenario === 'external-space')
        targets = [
          {
            id: 'research',
            name: 'Research archive',
            kind: 'space',
            sources: [{ id: 'survey', name: 'Survey results' }],
            state: sourceShared ? 'kept' : 'grant',
            access: sourceShared ? 'viewer' : null,
          },
        ];
      if (scenario === 'partial' || scenario === 'restricted') {
        targets = [
          ...(scenario === 'partial' ? targets : []),
          {
            ...forecast,
            state: 'requires-owner',
            access: null,
            id: 'partner',
            name: 'Partner costs',
          },
        ];
      }
      const redacted =
        (scenario === 'redacted-after-save' && sourceShared) ||
        (scenario === 'source-revoked' && attempts > 0);
      if (redacted) targets = [forecast];
      return {
        version: `${scenario}:${role}:${changed}:${sourceShared}`,
        userId: person.id,
        hostRole: role,
        hostAccess: role,
        targets,
        unavailable: scenario === 'restricted' || redacted,
      };
    };
    const intercepted: typeof fetch = async (input, init) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      if (path.endsWith('/sharing/review')) {
        if (revoked)
          return Response.json({ error: 'Sharing access was revoked.' }, { status: 403 });
        if (scenario === 'pending-review') return new Promise<Response>(() => {});
        if (scenario === 'failed-review')
          return Response.json({ error: 'Please try again shortly.' }, { status: 503 });
        return Response.json({ review: review(JSON.parse(String(init?.body)).role) });
      }
      if (path.endsWith('/sharing')) {
        if (revoked)
          return Response.json({ error: 'Sharing access was revoked.' }, { status: 403 });
        if (method === 'GET') return Response.json({ people: [person] });
        const body = JSON.parse(String(init?.body));
        setPayloads((current) => [...current, body]);
        attempts++;
        if (scenario === 'pending-write') return new Promise<Response>(() => {});
        if (scenario === 'changed' && attempts === 1) {
          changed = true;
          return Response.json(
            { error: 'Formula sources changed. Review the updated list before sharing them.' },
            { status: 409 },
          );
        }
        if (scenario === 'revoked') {
          revoked = true;
          return Response.json({ error: 'Sharing access was revoked.' }, { status: 403 });
        }
        if (scenario === 'source-revoked')
          return Response.json({ error: 'The update could not be confirmed.' }, { status: 503 });
        const host = person.directRole === body.role ? 'unchanged' : 'updated';
        const before = review(body.role);
        person = { ...person, directRole: body.role, effectiveRole: body.role };
        if (body.sourceReview) sourceShared = true;
        if (scenario === 'uncertain') throw new TypeError('Network response was lost.');
        if (!body.sourceReview || scenario === 'missing-result')
          return Response.json({ people: [person] });
        return Response.json({
          people: [person],
          sourceOutcome: {
            host,
            shared: before.targets
              .filter((target) => target.state === 'grant')
              .map((target) => target.id),
            failed: before.targets
              .filter((target) => target.state === 'requires-owner')
              .map((target) => target.id),
            // Retain the names authorized at confirmation; the fresh review may redact them.
            review: {
              ...before,
              targets: before.targets.map((target) =>
                target.state === 'grant' ? { ...target, state: 'kept', access: 'viewer' } : target,
              ),
            },
            complete: scenario !== 'partial',
          },
        });
      }
      if (path.endsWith('/link')) {
        if (method === 'PUT') linkEnabled = true;
        return Response.json({
          enabled: linkEnabled,
          role: 'viewer',
          ...(linkEnabled ? { url: 'https://spinel.example/share/report#guest-key' } : {}),
        });
      }
      return previous(input, init);
    };
    globalThis.fetch = intercepted;
    setReady(true);
    return () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = previous;
    };
  }, [scenario]);
  return (
    <>
      <output hidden data-testid="source-writes">
        {JSON.stringify(payloads)}
      </output>
      {ready && (
        <Sharing
          item={
            scenario === 'same-space'
              ? { ...report, kind: 'space', name: 'Research Space' }
              : report
          }
          onClose={() => {}}
        />
      )}
    </>
  );
}

const meta = {
  id: 'sharing-formula-sources',
  title: 'Current production/Sharing/Formula sources',
  component: SourceScenario,
  args: { scenario: 'ordinary' },
} satisfies Meta<typeof SourceScenario>;
export default meta;
type Story = StoryObj<typeof meta>;
const sourceChoice = 'Also share source spreadsheets';
async function checkSources(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  const checkbox = await body.findByRole('checkbox', { name: sourceChoice });
  await expect(checkbox).not.toBeChecked();
  await userEvent.click(checkbox);
  await expect(checkbox).toBeChecked();
  return body;
}
function writes(body: ReturnType<typeof within>) {
  return JSON.parse(body.getByTestId('source-writes').textContent ?? '[]') as {
    userId: string;
    role: GrantRole | null;
    sourceReview?: string;
  }[];
}
export const Unchecked: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
    await expect(body.getByText('Can edit · Kept')).toBeVisible();
    await expect(body.getByRole('button', { name: 'Apply access for Avery Chen' })).toBeDisabled();
    await expect(writes(body)).toHaveLength(0);
  },
};
export const Checked: Story = {
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await expect(body.getByText('Can view · Proposed')).toBeVisible();
    await expect(body.getByText('Can edit · Kept')).toBeVisible();
    await expect(body.getByRole('button', { name: 'Apply access for Avery Chen' })).toBeEnabled();
    await expect(writes(body)).toHaveLength(0);
  },
};
export const ChooseReportAccessFirst: Story = {
  args: { scenario: 'new-recipient' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await body.findByText('Choose access to the report before also sharing sources.');
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
export const HostOnly: Story = {
  args: { scenario: 'new-recipient' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await body.findByLabelText('Access for Avery Chen'), 'viewer');
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await body.findByText('Access updated for Avery Chen.');
    await expect(writes(body)).toEqual([{ userId: 'avery', role: 'viewer' }]);
    await expect(await body.findByText('No access', { exact: true })).toBeVisible();
  },
};
export const SourceOnly: Story = {
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await body.findByText(/Report access kept\. Source access updated: 1 target shared/);
    await expect(await body.findByText('Can view · Kept')).toBeVisible();
    await expect(body.getByText('Can edit · Kept')).toBeVisible();
    await expect(writes(body)).toEqual([
      { userId: 'avery', role: 'viewer', sourceReview: expect.any(String) },
    ]);
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
export const Checking: Story = { args: { scenario: 'pending-review' } };
export const CheckFailed: Story = {
  args: { scenario: 'failed-review' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const retry = await body.findByRole('button', { name: 'Retry source check' });
    retry.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.getByText('Formula sources', { exact: true })).toHaveFocus());
  },
};
export const Applying: Story = {
  args: { scenario: 'pending-write' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await expect(body.getByText('Updating access…')).toBeDisabled();
    await expect(body.getByRole('checkbox')).toBeDisabled();
    await expect(body.getByRole('button', { name: 'Done' })).toBeDisabled();
  },
};
export const ExistingAccessKept: Story = { args: { scenario: 'already-shared' } };
export const SameSpace: Story = {
  args: { scenario: 'same-space' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      await body.findByText('Sources in this Space inherit access. No separate sharing is needed.'),
    ).toBeVisible();
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
export const ExternalSpace: Story = {
  args: { scenario: 'external-space' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await expect(body.getByText('Entire Space', { exact: true })).toBeVisible();
    await expect(body.getByText('Survey results', { exact: true })).toBeVisible();
    await expect(
      body.getByText('Can view every current and future page and folder in this Space.'),
    ).toBeVisible();
  },
};
export const ProtectedAndUnavailable: Story = { args: { scenario: 'restricted' } };
export const Partial: Story = {
  args: { scenario: 'partial' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await body.findByText(/Some sources still need access or could not be reviewed/);
    await expect(await body.findByText('Can view · Kept')).toBeVisible();
    await expect(body.getByText('Owner or File admin must share')).toBeVisible();
    await expect(body.getByRole('button', { name: 'Review remaining sources' })).toBeEnabled();
  },
};
export const ChangedAfterReview: Story = {
  args: { scenario: 'changed' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await expect(await body.findByRole('alert')).toHaveTextContent('Formula sources changed.');
    await body.findByText('Household budget · revised');
    await expect(body.getByRole('checkbox')).not.toBeChecked();
    await expect(writes(body)).toHaveLength(1);
  },
};
async function uncertain(canvasElement: HTMLElement) {
  const body = await checkSources(canvasElement);
  await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
  await expect(await body.findByRole('alert')).toHaveTextContent('Could not confirm the update.');
  await expect(await body.findByText('Can view · Kept')).toBeVisible();
  await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  body.getByRole('button', { name: 'Review remaining sources' }).focus();
  await userEvent.keyboard('{Enter}');
  await body.findByText('Can view · Kept');
  await expect(body.getByLabelText('Access for Avery Chen')).toHaveFocus();
  await expect(writes(body)).toHaveLength(1);
}
export const LostAcknowledgement: Story = {
  args: { scenario: 'uncertain' },
  play: ({ canvasElement }) => uncertain(canvasElement),
};
export const MissingResult: Story = {
  args: { scenario: 'missing-result' },
  play: ({ canvasElement }) => uncertain(canvasElement),
};
export const HostOnlyLostAcknowledgement: Story = {
  args: { scenario: 'uncertain' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await body.findByLabelText('Access for Avery Chen'), 'admin');
    await body.findByRole('checkbox', { name: sourceChoice });
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await expect(await body.findByRole('alert')).toHaveTextContent('Could not confirm the update.');
    await expect(await body.findByText('Effective access: File admin.')).toBeVisible();
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
    await expect(writes(body)).toEqual([{ userId: 'avery', role: 'admin' }]);
  },
};
export const HostOnlyAuthorityLost: Story = {
  args: { scenario: 'revoked' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await body.findByLabelText('Access for Avery Chen'), 'admin');
    await body.findByRole('checkbox', { name: sourceChoice });
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await expect(await body.findByRole('alert')).toHaveTextContent(
      'Could not confirm the update or refresh access.',
    );
    await expect(body.queryByText('Household budget')).not.toBeInTheDocument();
    await expect(writes(body)).toEqual([{ userId: 'avery', role: 'admin' }]);
  },
};
export const HostOnlySourceBecamePrivate: Story = {
  args: { scenario: 'source-revoked' },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(await body.findByLabelText('Access for Avery Chen'), 'admin');
    await body.findByRole('checkbox', { name: sourceChoice });
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await body.findByText(/Another source is unavailable to you/);
    await expect(body.queryByText(/Household budget/)).not.toBeInTheDocument();
    await expect(writes(body)).toEqual([{ userId: 'avery', role: 'admin' }]);
  },
};
export const HostRevoked: Story = {
  args: { scenario: 'revoked' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await expect(await body.findByRole('alert')).toHaveTextContent(
      'Could not confirm the update or refresh access.',
    );
    await expect(body.queryByText('Household budget')).not.toBeInTheDocument();
    await expect(body.queryByText('Avery Chen')).not.toBeInTheDocument();
  },
};
export const NoStaleSourceNames: Story = {
  args: { scenario: 'redacted-after-save' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(body.getByRole('button', { name: 'Apply access for Avery Chen' }));
    await body.findByText(/Another source is unavailable to you/);
    await expect(body.queryByText(/Household budget/)).not.toBeInTheDocument();
    await expect(body.queryByRole('list', { name: 'Sources shared' })).not.toBeInTheDocument();
  },
};
export const PublicLinkIsolation: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await body.findByRole('checkbox', { name: sourceChoice });
    await userEvent.click(body.getByRole('button', { name: 'Create link' }));
    await body.findByLabelText('Guest link address');
    await expect(writes(body)).toHaveLength(0);
    await expect(
      body.getByText(
        'This link shares only the document. Formulas that need other files are unavailable to link guests.',
      ),
    ).toBeVisible();
  },
};

function DeferredReview({ replace = false }: { replace?: boolean }) {
  const [ready, setReady] = useState(false);
  const [left, setLeft] = useState(false);
  const [released, setReleased] = useState(false);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    const previous = globalThis.fetch;
    const intercepted: typeof fetch = async (input, init) => {
      const path = String(input);
      if (path.endsWith('/sharing/review')) {
        if (!path.includes('next-report'))
          return new Promise<Response>((resolve) => {
            release.current = () => {
              resolve(Response.json({ error: 'Sign in to continue.' }, { status: 401 }));
              setReleased(true);
            };
          });
        return Response.json({
          review: {
            version: 'next',
            userId: recipient.id,
            hostRole: 'viewer',
            hostAccess: 'viewer',
            targets: [forecast],
            unavailable: false,
          },
        });
      }
      if (path.endsWith('/sharing')) return Response.json({ people: [recipient] });
      if (path.endsWith('/link')) return Response.json({ enabled: false, role: 'viewer' });
      return previous(input, init);
    };
    globalThis.fetch = intercepted;
    setReady(true);
    return () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = previous;
      release.current = null;
    };
  }, []);
  return (
    <>
      <button hidden data-testid="leave-source-review" onClick={() => setLeft(true)}>
        Navigate
      </button>
      <button hidden data-testid="release-source-review" onClick={() => release.current?.()}>
        Release
      </button>
      <output hidden data-testid="source-released">
        {String(released)}
      </output>
      {ready && (!left || replace) && (
        <Sharing
          item={left ? { ...report, id: 'next-report', name: 'Next report' } : report}
          onClose={() => setLeft(true)}
        />
      )}
    </>
  );
}
async function staleReview(canvasElement: HTMLElement, replace: boolean) {
  const body = within(canvasElement.ownerDocument.body);
  await body.findByText('Checking formula sources… You can share the report alone.');
  fireEvent.click(body.getByTestId('leave-source-review'));
  if (replace) await body.findByText('Can edit · Kept');
  const href = location.href;
  fireEvent.click(body.getByTestId('release-source-review'));
  await waitFor(() => expect(body.getByTestId('source-released')).toHaveTextContent('true'));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await expect(location.href).toBe(href);
  await expect(body.queryByRole('alert')).not.toBeInTheDocument();
  if (replace) await expect(body.getByRole('dialog', { name: 'Share Next report' })).toBeVisible();
  else await expect(body.queryByRole('dialog')).not.toBeInTheDocument();
}
export const ReviewAfterLeaving: Story = {
  render: () => <DeferredReview />,
  play: ({ canvasElement }) => staleReview(canvasElement, false),
};
export const ReviewAfterReplacing: Story = {
  render: () => <DeferredReview replace />,
  play: ({ canvasElement }) => staleReview(canvasElement, true),
};
