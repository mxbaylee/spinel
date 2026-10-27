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
          ...(scenario === 'partial'
            ? [targets[0], { ...forecast, access: 'viewer' as const }]
            : []),
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
const sourceChoice = 'Include formula sources';
async function openEditor(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole('button', { name: 'Edit access for Avery Chen' }));
  await body.findByRole('combobox', { name: 'Access for Avery Chen' });
  return body;
}
const save = (body: ReturnType<typeof within>) =>
  body.getByRole('button', { name: /^(Share|Save changes)$/ });
async function checkSources(canvasElement: HTMLElement) {
  const body = await openEditor(canvasElement);
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
export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await body.findByRole('button', { name: 'Edit access for Avery Chen' });
    await expect(body.queryByRole('combobox')).not.toBeInTheDocument();
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
    await expect(body.getByRole('button', { name: 'Copy account link' })).toBeVisible();
    await expect(writes(body)).toHaveLength(0);
  },
};
export const Unchecked: Story = {
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
    await expect(body.getByText('Some formulas won’t work without source access.')).toBeVisible();
    await expect(body.getByText('Household budget')).not.toBeVisible();
    await expect(save(body)).toBeDisabled();
    await expect(writes(body)).toHaveLength(0);
  },
};
export const Checked: Story = {
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await expect(body.getByText('Can view · Proposed')).toBeVisible();
    await expect(body.getByText('Household budget')).toBeVisible();
    await expect(body.getByText('Forecast')).not.toBeVisible();
    await expect(save(body)).toBeEnabled();
    await expect(writes(body)).toHaveLength(0);
  },
};
export const ChooseReportAccessFirst: Story = {
  args: { scenario: 'new-recipient' },
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    await body.findByText('Choose access to the report to include its sources.');
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
export const HostOnly: Story = {
  args: { scenario: 'new-recipient' },
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    await userEvent.selectOptions(body.getByRole('combobox'), 'viewer');
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
    await userEvent.click(save(body));
    await body.findByText('Access updated for Avery Chen.');
    await expect(writes(body)).toEqual([{ userId: 'avery', role: 'viewer' }]);
    await waitFor(() =>
      expect(body.getByRole('button', { name: 'Edit access for Avery Chen' })).toHaveFocus(),
    );
    await expect(body.queryByRole('combobox')).not.toBeInTheDocument();
    await openEditor(canvasElement);
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
  },
};
export const SourceOnly: Story = {
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(save(body));
    await body.findByText('Formula sources shared for Avery Chen.');
    await expect(writes(body)).toEqual([
      { userId: 'avery', role: 'viewer', sourceReview: expect.any(String) },
    ]);
    await openEditor(canvasElement);
    await userEvent.click(await body.findByText('Already accessible (2)'));
    const list = within(body.getByRole('list', { name: 'Reviewed source access' }));
    await expect(list.getByText('View only')).toBeVisible();
    await expect(list.getByText('Can edit')).toBeVisible();
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
export const Checking: Story = {
  args: { scenario: 'pending-review' },
  play: async ({ canvasElement }) => {
    await openEditor(canvasElement);
  },
};
export const CheckFailed: Story = {
  args: { scenario: 'failed-review' },
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    const retry = await body.findByRole('button', { name: 'Retry source check' });
    retry.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.getByRole('combobox')).toHaveFocus());
    const retryAgain = await body.findByRole('button', { name: 'Retry source check' });
    const peopleTab = body.getByRole('tab', { name: 'People' });
    retryAgain.focus();
    retryAgain.click();
    await new Promise<void>((resolve) =>
      queueMicrotask(() => {
        peopleTab.focus();
        resolve();
      }),
    );
    await waitFor(() => expect(retryAgain).not.toBeInTheDocument());
    await expect(await body.findByRole('button', { name: 'Retry source check' })).toBeVisible();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await expect(peopleTab).toHaveFocus();
  },
};
export const Applying: Story = {
  args: { scenario: 'pending-write' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(save(body));
    await expect(body.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await expect(body.getByRole('checkbox')).toBeDisabled();
    await expect(body.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(body.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    for (const tab of body.getAllByRole('tab'))
      await expect(tab).toHaveAttribute('aria-disabled', 'true');
    body.getByRole('tab', { name: 'People' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(body.getByRole('tab', { name: 'People' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    await expect(body.getByRole('dialog')).toBeVisible();
  },
};
export const ExistingAccessKept: Story = {
  args: { scenario: 'already-shared' },
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    await userEvent.click(await body.findByText('Already accessible (2)'));
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
export const SameSpace: Story = {
  args: { scenario: 'same-space' },
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    await expect(await body.findByText('Sources in this Space inherit access.')).toBeVisible();
    await expect(
      within(body.getByRole('tabpanel', { name: 'People' })).getByText(
        'Applies to every current and future page and folder in this Space.',
      ),
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
export const ProtectedAndUnavailable: Story = {
  args: { scenario: 'restricted' },
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    await body.findByText(
      'Some formulas need source access from the Owner or File admin. Other sources are unavailable to you.',
    );
    await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  },
};
export const Partial: Story = {
  args: { scenario: 'partial' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(save(body));
    await body.findByText(/some sources still need access or review/);
    await expect(await body.findByText('View only · Shared')).toBeVisible();
    const reviewed = within(body.getByRole('list', { name: 'Reviewed source access' }));
    await expect(reviewed.getByText('View only', { exact: true })).toBeVisible();
    await expect(body.getByText('Owner or File admin must share')).toBeVisible();
    await expect(save(body)).toBeDisabled();
    await expect(
      body.queryByRole('button', { name: 'Review remaining sources' }),
    ).not.toBeInTheDocument();
    await expect(writes(body)).toHaveLength(1);
  },
};
export const ChangedAfterReview: Story = {
  args: { scenario: 'changed' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(save(body));
    await expect(await body.findByRole('alert')).toHaveTextContent('Formula sources changed.');
    await expect(await body.findByRole('checkbox')).not.toBeChecked();
    await userEvent.click(body.getByText('Source details'));
    await expect(body.getByText('Household budget · revised')).toBeVisible();
    await expect(writes(body)).toHaveLength(1);
  },
};
async function uncertain(canvasElement: HTMLElement) {
  const body = await checkSources(canvasElement);
  await userEvent.click(save(body));
  await expect(await body.findByRole('alert')).toHaveTextContent('Could not confirm the update.');
  await body.findByText('Already accessible (2)');
  await waitFor(() => expect(body.getByRole('combobox')).toHaveFocus());
  await expect(save(body)).toBeDisabled();
  await expect(body.queryByRole('checkbox')).not.toBeInTheDocument();
  await userEvent.click(body.getByText('Already accessible (2)'));
  await expect(
    within(body.getByRole('list', { name: 'Reviewed source access' })).getByText('View only'),
  ).toBeVisible();
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
    const body = await openEditor(canvasElement);
    await userEvent.selectOptions(body.getByRole('combobox'), 'admin');
    await body.findByRole('checkbox', { name: sourceChoice });
    await userEvent.click(save(body));
    await expect(await body.findByRole('alert')).toHaveTextContent('Could not confirm the update.');
    await expect(
      body.getByRole('button', { name: 'Edit access for Avery Chen' }),
    ).toHaveTextContent('File admin');
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
    await expect(save(body)).toBeDisabled();
    await expect(writes(body)).toEqual([{ userId: 'avery', role: 'admin' }]);
  },
};
export const HostOnlyAuthorityLost: Story = {
  args: { scenario: 'revoked' },
  play: async ({ canvasElement }) => {
    const body = await openEditor(canvasElement);
    await userEvent.selectOptions(body.getByRole('combobox'), 'admin');
    await body.findByRole('checkbox', { name: sourceChoice });
    await userEvent.click(save(body));
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
    const body = await openEditor(canvasElement);
    await userEvent.selectOptions(body.getByRole('combobox'), 'admin');
    await body.findByRole('checkbox', { name: sourceChoice });
    await userEvent.click(save(body));
    await body.findByText('Some sources are unavailable to you.');
    await expect(body.queryByText(/Household budget/)).not.toBeInTheDocument();
    await expect(writes(body)).toEqual([{ userId: 'avery', role: 'admin' }]);
  },
};
export const HostRevoked: Story = {
  args: { scenario: 'revoked' },
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.click(save(body));
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
    await userEvent.click(save(body));
    await body.findByText('Formula sources shared for Avery Chen.');
    await openEditor(canvasElement);
    await body.findByText('Some sources are unavailable to you.');
    await expect(body.queryByText(/Household budget/)).not.toBeInTheDocument();
  },
};
export const ConsentAndDraftReset: Story = {
  play: async ({ canvasElement }) => {
    const body = await checkSources(canvasElement);
    await userEvent.selectOptions(body.getByRole('combobox'), 'editor');
    await expect(await body.findByRole('checkbox', { name: sourceChoice })).not.toBeChecked();
    await userEvent.click(body.getByRole('checkbox'));
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(body.getByRole('button', { name: 'Edit access for Avery Chen' })).toHaveFocus(),
    );
    await openEditor(canvasElement);
    await expect(body.getByRole('combobox')).toHaveValue('viewer');
    await expect(await body.findByRole('checkbox')).not.toBeChecked();
    await userEvent.click(body.getByRole('checkbox'));
    await userEvent.selectOptions(body.getByRole('combobox'), 'admin');
    const peopleTab = body.getByRole('tab', { name: 'People' });
    const linkTab = body.getByRole('tab', { name: 'Link' });
    peopleTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(linkTab).toHaveAttribute('aria-selected', 'true');
    await expect(linkTab).toHaveFocus();
    await expect(
      body.queryByRole('combobox', { name: 'Access for Avery Chen' }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(peopleTab).toHaveAttribute('aria-selected', 'true');
    await expect(peopleTab).toHaveFocus();
    await openEditor(canvasElement);
    await expect(body.getByRole('combobox')).toHaveValue('viewer');
    await expect(await body.findByRole('checkbox')).not.toBeChecked();
    await expect(writes(body)).toHaveLength(0);
  },
};
export const PublicLinkIsolation: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('tab', { name: 'Link' }));
    await userEvent.click(await body.findByRole('button', { name: 'Create link' }));
    const address = await body.findByLabelText('Guest link address');
    await expect(address).toHaveValue('https://spinel.example/share/report#guest-key');
    await expect(writes(body)).toHaveLength(0);
    await expect(
      body.getByText(
        'Shares this document only. Formulas using other files are unavailable to guests.',
      ),
    ).toBeVisible();
    const peopleTab = body.getByRole('tab', { name: 'People' });
    const linkTab = body.getByRole('tab', { name: 'Link' });
    // The URL can render before the parent's write guard clears. Wait for the
    // tab to accept navigation, then assert the mounted Link panel is hidden.
    await waitFor(() => expect(peopleTab).not.toHaveAttribute('aria-disabled', 'true'));
    await userEvent.click(peopleTab);
    await waitFor(() => {
      expect(peopleTab).toHaveAttribute('aria-selected', 'true');
      expect(address).not.toBeVisible();
    });
    await userEvent.click(linkTab);
    await waitFor(() => expect(linkTab).toHaveAttribute('aria-selected', 'true'));
    await expect(body.getByLabelText('Guest link address')).toHaveValue(
      'https://spinel.example/share/report#guest-key',
    );
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
  await openEditor(canvasElement);
  await body.findByText('Checking sources…');
  fireEvent.click(body.getByTestId('leave-source-review'));
  if (replace) {
    await body.findByRole('dialog', { name: 'Share Next report' });
    await openEditor(canvasElement);
    await body.findByText('Already accessible (1)');
  }
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
