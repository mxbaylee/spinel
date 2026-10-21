import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { defaultProfile } from '../../profile/profile.ts';
import { EntryPreview } from './EntryJourney.tsx';
import {
  AdminMockup,
  DashboardMockup,
  EditorMockup,
  EntryMockup,
  FormulaMockup,
  HistoryMockup,
  ProfileMockup,
  ReviewProfileContext,
  SharingMockup,
  SpaceTree,
} from './Mockups.tsx';
import type { SpaceEntry } from './Mockups.tsx';

const meta = {
  title: 'Redesign/Screens',
  parameters: {
    shell: 'none',
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'SPN-047 proposal. Composed review mockups; interactions use local state only. Editor surfaces represent chrome placement and do not run Univer. Space and File admin are planned features.',
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const entryTheme: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const header = within(within(canvasElement).getByRole('banner'));
  const choice = within(header.getByRole('radiogroup', { name: 'Appearance' }));
  for (const name of ['Follow system', 'Light', 'Dark']) {
    await expect(choice.getByRole('radio', { name })).toBeVisible();
  }
};
export const Dashboard: Story = { render: () => <DashboardMockup /> };
export const SidebarLongDisplayName: Story = {
  render: () => (
    <ReviewProfileContext.Provider
      value={{
        profile: defaultProfile('Alexandra Baylee Fernández de la Cruz'),
        save: () => {},
      }}
    >
      <DashboardMockup />
    </ReviewProfileContext.Provider>
  ),
};
export const EmptyFolder: Story = { render: () => <DashboardMockup state="empty" /> };
export const LoadingFiles: Story = { render: () => <DashboardMockup state="loading" /> };
export const FileError: Story = { render: () => <DashboardMockup state="error" /> };
export const Search: Story = { render: () => <DashboardMockup state="search" /> };
export const SharedFiles: Story = { render: () => <DashboardMockup state="shared" /> };
export const Trash: Story = { render: () => <DashboardMockup state="trash" /> };
export const Doc: Story = { render: () => <EditorMockup /> };
export const FileIconHint: Story = {
  render: () => <EditorMockup space />,
  play: async ({ canvasElement }) => {
    await userEvent.hover(
      within(canvasElement).getByRole('button', { name: 'File icon — customization planned' }),
    );
  },
};
export const Sheet: Story = { render: () => <EditorMockup sheet /> };
export const ViewOnly: Story = { render: () => <EditorMockup viewOnly /> };
export const OfflineEditor: Story = { render: () => <EditorMockup offline /> };
export const FormulaInContext: Story = { render: () => <EditorMockup formula /> };
export const Formula: Story = { render: () => <FormulaMockup /> };
export const History: Story = { render: () => <HistoryMockup /> };
export const HistoryViewer: Story = { render: () => <HistoryMockup viewOnly /> };
export const HistoryUnsaved: Story = { render: () => <HistoryMockup saveState="failed" /> };
export const HistorySaving: Story = { render: () => <HistoryMockup saveState="saving" /> };
export const HistoryOffline: Story = { render: () => <HistoryMockup offline /> };
export const HistoryNaming: Story = {
  render: () => <HistoryMockup />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Name current version…' }),
    );
  },
};
export const Sharing: Story = { render: () => <SharingMockup /> };
export const PlannedFileAdmin: Story = { render: () => <SharingMockup delegated /> };
export const Profile: Story = { render: () => <ProfileMockup /> };
export const Connections: Story = { render: () => <ProfileMockup section="connections" /> };
export const ThisDevice: Story = { render: () => <ProfileMockup section="device" /> };
export const Admin: Story = { render: () => <AdminMockup /> };
export const AdminLoading: Story = { render: () => <AdminMockup state="loading" /> };
export const AdminError: Story = { render: () => <AdminMockup state="error" /> };
export const SignIn: Story = { render: () => <EntryPreview screen="sign-in" /> };
export const Setup: Story = { render: () => <EntryPreview screen="setup" /> };
export const Invite: Story = { render: () => <EntryPreview screen="invite" /> };
export const Recovery: Story = { render: () => <EntryPreview screen="recovery" /> };
export const Consent: Story = { render: () => <EntryMockup kind="consent" />, play: entryTheme };
export const ConsentExpired: Story = {
  render: () => <EntryMockup kind="consent-expired" />,
  play: entryTheme,
};
export const GuestViewer: Story = { render: () => <EditorMockup guest viewOnly /> };
export const GuestEditor: Story = { render: () => <EditorMockup guest /> };
export const RevokedLink: Story = {
  render: () => <EntryMockup kind="revoked" />,
  play: entryTheme,
};
export const OfflineLaunch: Story = {
  render: () => <EntryMockup kind="offline" />,
  play: entryTheme,
};
export const MissingFile: Story = {
  render: () => <EntryMockup kind="missing" />,
  play: entryTheme,
};
export const PlannedSpace: Story = { render: () => <EditorMockup space /> };
export const PlannedSpaceGuest: Story = { render: () => <EditorMockup space guest viewOnly /> };
export const Passkeys: Story = { render: () => <ProfileMockup section="security" /> };
export const AdminInvites: Story = { render: () => <AdminMockup section="Invites" /> };
export const AdminConnections: Story = { render: () => <AdminMockup section="Connections" /> };
export const AdminHealth: Story = { render: () => <AdminMockup section="Backups & health" /> };
export const FormulaPrivate: Story = { render: () => <FormulaMockup state="private" /> };
export const FormulaOffline: Story = { render: () => <FormulaMockup state="offline" /> };
export const FormulaInvalid: Story = { render: () => <FormulaMockup state="invalid" /> };
export const FormulaLoading: Story = { render: () => <FormulaMockup state="loading" /> };
export const FormulaEmpty: Story = { render: () => <FormulaMockup state="empty" /> };
export const FormulaTable: Story = { render: () => <FormulaMockup state="table" /> };
export const HistoryCalendar: Story = { render: () => <HistoryMockup calendar /> };
export const AdvancedSearch: Story = { render: () => <DashboardMockup state="filtered" /> };
export const NoMatches: Story = {
  render: () => <DashboardMockup state="no-results" />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByRole('button', { name: 'Clear filters' }),
    ).toHaveLength(1);
  },
};
export const FilteredNoMatches: Story = {
  render: () => <DashboardMockup state="filtered" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('combobox', { name: 'File type' }));
    await userEvent.click(portal.getByRole('option', { name: 'Sheets' }));
    await userEvent.click(canvas.getByRole('combobox', { name: 'Ownership' }));
    // The household Sheet belongs to a collaborator; Mine excludes it.
    await userEvent.click(portal.getByRole('option', { name: /^Mine$/ }));
    await userEvent.click(canvas.getByRole('combobox', { name: 'Last modified' }));
    await userEvent.click(portal.getByRole('option', { name: 'Today' }));
    await expect(canvas.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(1);
  },
};
export const PlannedSpaceGuestEditor: Story = { render: () => <EditorMockup space guest /> };
export const PlannedSpaceTrash: Story = {
  render: () => <EditorMockup space initialPage="Trash" />,
};

export const FormulaTableInContext: Story = { render: () => <EditorMockup table /> };
export const SharingCreatedLink: Story = { render: () => <SharingMockup state="created" /> };
export const SharingExistingLink: Story = { render: () => <SharingMockup state="existing" /> };
export const SharingReplaceLink: Story = { render: () => <SharingMockup state="replace" /> };
export const SharingError: Story = { render: () => <SharingMockup state="error" /> };
export const ConsentReadOnly: Story = { render: () => <EntryMockup kind="consent" readOnly /> };

export const PlannedGuestLinks: Story = { render: () => <ProfileMockup section="links" /> };

export const DashboardCollapsed: Story = { render: () => <DashboardMockup collapsed /> };
export const Folder: Story = { render: () => <DashboardMockup state="folder" /> };
export const CollaboratorSheet: Story = { render: () => <EditorMockup sheet collaborator /> };
export const PlannedSpaceCollapsed: Story = { render: () => <EditorMockup space collapsed /> };
export const GuestSheet: Story = { render: () => <EditorMockup guest sheet viewOnly /> };
export const GuestLongTitle: Story = {
  render: () => (
    <EditorMockup guest viewOnly title="A longer shared document title for our autumn trip" />
  ),
};
export const AdminInviteCreated: Story = {
  render: () => <AdminMockup section="Invites" state="invite-created" />,
};
export const AdminHealthWarning: Story = {
  render: () => <AdminMockup section="Backups & health" state="health-warning" />,
};
export const AdminDisable: Story = { render: () => <AdminMockup state="disable" /> };
export const AdminPasskeys: Story = { render: () => <AdminMockup state="passkeys" /> };

export const HistoryRestore: Story = { render: () => <HistoryMockup confirmation /> };

export const PlannedSpaceViewer: Story = { render: () => <EditorMockup space viewOnly /> };

const deepPageName = 'Museum reservations and accessible routes for our Saturday afternoon in Rome';
const deepParents = ['Travel', 'Autumn', 'Europe', 'Italy', 'Rome', 'Weekend', 'Saturday'];
const deepPages: SpaceEntry[] = [
  { name: 'Welcome', kind: 'doc' },
  ...deepParents.reduceRight<SpaceEntry[]>(
    (children, name, level) => [
      {
        name,
        kind: level % 2 ? 'folder' : 'doc',
        children: [{ name: `${name} overview`, kind: 'doc' }, ...children],
      },
    ],
    [{ name: deepPageName, kind: 'sheet' }],
  ),
];
function DeepSpaceTree() {
  const [selected, setSelected] = useState(deepPageName);
  return (
    <nav
      className="sp-ui rd-sidebar rd-space-sidebar rd-space-tree-example"
      aria-label="Space contents"
    >
      <div className="rd-space-nav-heading">
        <h2>Autumn plans</h2>
      </div>
      <SpaceTree
        entries={deepPages}
        selected={selected}
        onSelect={setSelected}
        onAction={() => {}}
      />
    </nav>
  );
}
export const PlannedSpaceDeepTree: Story = {
  render: () => <DeepSpaceTree />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const icon = (name: string) =>
      canvas.getByRole('button', { name }).querySelector('svg')!.getBoundingClientRect();
    // Every level uses the same indent whether its node is a parent or a leaf.
    await expect(icon('Welcome').x).toBeCloseTo(icon('Travel').x, 1);
    for (let level = 0; level < deepParents.length; level++) {
      const parent = deepParents[level];
      const child = deepParents[level + 1] ?? deepPageName;
      await expect(icon(child).x - icon(parent).x).toBeCloseTo(16, 1);
      await expect(icon(`${parent} overview`).x).toBeCloseTo(icon(child).x, 1);
    }
    const touch = canvasElement.ownerDocument.defaultView!.matchMedia(
      '(pointer: coarse), (max-width: 640px)',
    ).matches;
    for (const gutter of canvasElement.querySelectorAll<HTMLElement>(
      '.rd-space-toggle, .rd-space-toggle-placeholder',
    )) {
      await expect(gutter.getBoundingClientRect().width).toBe(touch ? 44 : 24);
      if (touch && gutter.tagName === 'BUTTON')
        await expect(gutter.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    const leaf = canvas.getByRole('button', { name: deepPageName });
    await expect(leaf).toHaveAttribute('title', deepPageName);
    const label = leaf.querySelector('span')!;
    await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse Travel' }));
    await expect(canvas.queryByRole('button', { name: deepPageName })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Expand Travel' }));
    await expect(canvas.getByRole('button', { name: deepPageName })).toHaveAttribute(
      'aria-current',
      'page',
    );
  },
};

export const DashboardGrid: Story = { render: () => <DashboardMockup initialLayout="grid" /> };
export const DashboardGridCollapsed: Story = {
  render: () => <DashboardMockup initialLayout="grid" collapsed />,
};

export const DashboardNewMenu: Story = {
  render: () => <DashboardMockup />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'New file' }));
  },
};

export const ProfileIconPicker: Story = { render: () => <ProfileMockup initialPicker="icon" /> };
export const ProfileColorPicker: Story = { render: () => <ProfileMockup initialPicker="color" /> };

export const PlannedSpaceRestore: Story = {
  render: () => <EditorMockup space initialPage="Trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Restore Old itinerary' }));
    await expect(canvas.queryByRole('listitem', { name: 'Old itinerary' })).not.toBeInTheDocument();
    await expect(
      canvas.getByText('Old itinerary restored to Weekend trip in this preview.'),
    ).toBeVisible();
    if (window.innerWidth <= 900)
      await userEvent.click(canvas.getByRole('button', { name: 'Open Space contents' }));
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(await portal.findByRole('button', { name: 'Old itinerary' }));
    await expect(canvas.getByRole('heading', { level: 1, name: 'Old itinerary' })).toBeVisible();
  },
};

export const FolderColorPicker: Story = {
  render: () => <DashboardMockup state="folder" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Change color for Household' }),
    );
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Folder color · Household',
      }),
    );
    await expect(dialog.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Success, strong' })).toBeVisible();
  },
};
export const FolderColorChanged: Story = {
  render: () => <DashboardMockup state="folder" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Change color for Household' }));
    const dialog = within(await portal.findByRole('dialog', { name: 'Folder color · Household' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Success, strong' }));
    await expect(canvas.getByText('Color changed for Household in this preview.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Change color for Household' }));
    await expect(
      within(await portal.findByRole('dialog')).getByRole('button', { name: 'Success, strong' }),
    ).toHaveAttribute('aria-pressed', 'true');
  },
};
export const FolderColorReset: Story = {
  ...FolderColorChanged,
  play: async (context) => {
    await FolderColorChanged.play!(context);
    const portal = within(context.canvasElement.ownerDocument.body);
    await userEvent.click(
      within(await portal.findByRole('dialog')).getByRole('button', { name: 'Reset to default' }),
    );
    await expect(
      within(context.canvasElement).getByText(
        'Default color restored for Household in this preview.',
      ),
    ).toBeVisible();
    await userEvent.click(
      within(context.canvasElement).getByRole('button', { name: 'Change color for Household' }),
    );
    const dialog = within(await portal.findByRole('dialog'));
    await expect(dialog.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Success, strong' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  },
};
export const PlannedSpaceRestoreFolder: Story = {
  render: () => <EditorMockup space initialPage="Trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Restore Archived plans' }));
    await expect(
      canvas.queryByRole('listitem', { name: 'Archived plans' }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(
        'Archived plans restored to Autumn plans in this preview, with its contents.',
      ),
    ).toBeVisible();
    if (window.innerWidth <= 900)
      await userEvent.click(canvas.getByRole('button', { name: 'Open Space contents' }));
    const portal = within(canvasElement.ownerDocument.body);
    await expect(await portal.findByRole('button', { name: 'Archived plans' })).toBeVisible();
    await expect(portal.getByRole('button', { name: 'Earlier notes' })).toBeVisible();
    await expect(portal.getByRole('button', { name: 'Earlier costs' })).toBeVisible();
  },
};
export const PlannedSpaceRestoreMissingParent: Story = {
  render: () => <EditorMockup space initialPage="Trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Restore Packing checklist' }));
    await expect(
      canvas.getByText('Packing checklist restored to Autumn plans in this preview.'),
    ).toBeVisible();
    await expect(
      canvas.queryByRole('listitem', { name: 'Packing checklist' }),
    ).not.toBeInTheDocument();
  },
};
export const PlannedSpaceDeleteFolder: Story = {
  render: () => <EditorMockup space initialPage="Trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Actions for deleted Archived plans' }),
    );
    await userEvent.click(await portal.findByRole('menuitem', { name: 'Delete permanently' }));
    const dialog = within(
      await portal.findByRole('dialog', { name: 'Delete Archived plans permanently?' }),
    );
    await expect(dialog.getByText('Earlier notes')).toBeVisible();
    await expect(dialog.getByText('Earlier costs')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await expect(canvas.getByRole('listitem', { name: 'Archived plans' })).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Actions for deleted Archived plans' }),
    );
    await userEvent.click(await portal.findByRole('menuitem', { name: 'Delete permanently' }));
    await userEvent.click(
      within(await portal.findByRole('dialog')).getByRole('button', { name: 'Delete permanently' }),
    );
    await expect(
      canvas.queryByRole('listitem', { name: 'Archived plans' }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText('Archived plans and its contents permanently deleted from this preview.'),
    ).toBeVisible();
    await expect(canvas.getByRole('listitem', { name: 'Old itinerary' })).toBeVisible();
  },
};
export const PlannedSpaceTrashOffline: Story = {
  render: () => <EditorMockup space offline initialPage="Trash" />,
  play: async ({ canvasElement }) => {
    for (const button of within(canvasElement).getAllByRole('button', { name: /^Restore / }))
      await expect(button).toBeDisabled();
  },
};
export const PlannedSpaceTrashCollaborator: Story = {
  render: () => <EditorMockup space collaborator initialPage="Trash" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Restore Old itinerary' })).toBeVisible();
    await expect(
      canvas.queryByRole('button', { name: /^Actions for deleted/ }),
    ).not.toBeInTheDocument();
  },
};
export const PlannedSpaceTrashViewer: Story = {
  render: () => <EditorMockup space viewOnly initialPage="Trash" />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: /^Restore / }),
    ).not.toBeInTheDocument();
  },
};

export const PlannedSpaceTrashFromEditor: Story = {
  render: () => <EditorMockup space exportState="open" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByRole('heading', { name: 'Export' })).toBeVisible();
    if (window.innerWidth <= 900)
      await userEvent.click(canvas.getByRole('button', { name: 'Open Space contents' }));
    await userEvent.click(page.getByRole('button', { name: 'Trash' }));
    await expect(canvas.getByRole('heading', { name: 'Space trash' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Export' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Univer file' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('list', { name: 'Deleted pages and folders' })).toBeVisible();
  },
};
