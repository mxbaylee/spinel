import { SaveStatus } from './SaveStatus.tsx';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { ConnectionStatus } from './ConnectionStatus.tsx';

const meta = {
  id: 'shell-connectionstatus',
  title: 'Current production/Shell/ConnectionStatus',
  component: ConnectionStatus,
  args: { state: 'online' },
  parameters: {
    docs: {
      description: {
        component:
          'The production connection indicator with deterministic state fixtures. No health requests or collaboration sessions run here. Connection state is independent of the separate document save warning.',
      },
    },
  },
  render: function Example(args) {
    const [ready, setReady] = useState(false);
    const [saveTarget, setSaveTarget] = useState<HTMLSpanElement | null>(null);
    // A built preview can finish rendering before passive effects attach the
    // popover's native hover listeners. Let the fixture finish that phase first.
    useEffect(() => setReady(true), []);
    return (
      <section
        aria-label="Connection indicator example"
        data-interactions-ready={ready}
        style={{ padding: 24 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GemLogo />
          <ConnectionStatus {...args} />
        </div>
        {args.documentOpen && (
          // An intentionally pending save fixture makes the two meanings visible together.
          <div className="editor-title-status">
            <h2>Travel plans</h2>
            <span className="save-slot" ref={setSaveTarget} />
            <SaveStatus
              target={saveTarget}
              state={{
                dirty: true,
                failed: true,
                message: 'Changes not saved yet — keep this tab open.',
              }}
              onRetry={() => {}}
            />
          </div>
        )}
      </section>
    );
  },
} satisfies Meta<typeof ConnectionStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

const waitForInteractions = (canvasElement: HTMLElement) =>
  waitFor(() =>
    expect(
      within(canvasElement).getByRole('region', { name: 'Connection indicator example' }),
    ).toHaveAttribute('data-interactions-ready', 'true'),
  );

const showDetail: NonNullable<Story['play']> = async ({ canvasElement }) => {
  await waitForInteractions(canvasElement);
  await userEvent.hover(
    within(canvasElement).getByRole('button', { name: /^(Online|Offline|Reconnecting) —/ }),
  );
  await expect(
    await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Connection details',
    }),
  ).toBeVisible();
};
// The screenshot runner fixes its clock to this date; assertions do not depend on locale.
const syncedAt = Date.UTC(2026, 9, 20, 14, 5);
const localCatalog = { syncedAt, local: true, stale: true };

/** Successful server reachability or a joined editor session, without any save claim. */
export const Online: Story = { play: showDetail };
/** The connection is unavailable; the fixed control remains beside the gem. */
export const Offline: Story = { args: { state: 'offline' }, play: showDetail };
/** Browser connectivity has returned, but the server or document subscription is not ready. */
export const Reconnecting: Story = { args: { state: 'reconnecting' }, play: showDetail };

/** An interrupted dashboard keeps its last-loaded catalog timestamp discoverable. */
export const LastSyncedCatalog: Story = {
  args: { state: 'offline', catalog: { syncedAt, local: false, stale: true } },
  play: async (context) => {
    await showDetail(context);
    await expect(
      within(context.canvasElement.ownerDocument.body).getByText(/^Files as of /),
    ).toBeVisible();
  },
};

/** A prepared device keeps its last-synced catalog while downloaded files can be edited. */
export const LocalMode: Story = {
  args: { state: 'offline', catalog: localCatalog },
  play: showDetail,
};

/** Connectivity returning does not make the cached catalog fresh or prove a durable save. */
export const OnlineLocalMode: Story = {
  args: { catalog: localCatalog },
  play: async (context) => {
    await showDetail(context);
    const page = within(context.canvasElement.ownerDocument.body);
    await expect(page.getByText(/^Files as of /)).toBeVisible();
    await expect(
      page.getByText(/^Downloaded documents can be edited with their saved permissions/),
    ).toBeVisible();
  },
};

/** A recovered server connection does not make an already-loaded file list fresh. */
export const OnlineStaleCatalog: Story = {
  args: { catalog: { syncedAt, local: false, stale: true } },
  play: showDetail,
};

/** A connected editor can still have an unconfirmed save; both statements remain explicit. */
export const OnlinePendingSave: Story = {
  args: { documentOpen: true },
  play: async (context) => {
    await showDetail(context);
    const page = within(context.canvasElement.ownerDocument.body);
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveTextContent(
      'Changes not saved yet',
    );
    await expect(
      page.getByText(/Check the document’s separate save status before closing/),
    ).toBeVisible();
  },
};

/** Focus exposes the same detail; Escape dismisses it without moving keyboard focus. */
export const KeyboardDetails: Story = {
  args: { state: 'reconnecting' },
  play: async ({ canvasElement }) => {
    await waitForInteractions(canvasElement);
    const trigger = within(canvasElement).getByRole('button', {
      name: 'Reconnecting — connecting to Spinel',
    });
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await expect(await page.findByRole('dialog', { name: 'Connection details' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(page.queryByRole('dialog', { name: 'Connection details' })).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

/** A touch tap opens detail without hover; an outside tap dismisses it. */
export const TouchDetails: Story = {
  args: { state: 'offline', catalog: localCatalog },
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    await waitForInteractions(canvasElement);
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Offline — not connected to Spinel' });
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.pointer({ keys: '[TouchA]', target: trigger });
    await expect(await page.findByRole('dialog', { name: 'Connection details' })).toBeVisible();
    await userEvent.pointer({
      keys: '[TouchA]',
      target: canvas.getByRole('img', { name: 'Spinel' }),
    });
    await waitFor(() =>
      expect(page.queryByRole('dialog', { name: 'Connection details' })).not.toBeInTheDocument(),
    );
    // Leave the detail visible for the screenshot after exercising dismissal.
    await userEvent.pointer({ keys: '[TouchA]', target: trigger });
    await expect(await page.findByRole('dialog', { name: 'Connection details' })).toBeVisible();
  },
};
