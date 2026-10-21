import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { defaultProfile } from '../../profile/profile.ts';
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
} from './Mockups.tsx';

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
export const Sheet: Story = { render: () => <EditorMockup sheet /> };
export const ViewOnly: Story = { render: () => <EditorMockup viewOnly /> };
export const OfflineEditor: Story = { render: () => <EditorMockup offline /> };
export const FormulaInContext: Story = { render: () => <EditorMockup formula /> };
export const Formula: Story = { render: () => <FormulaMockup /> };
export const History: Story = { render: () => <HistoryMockup /> };
export const HistoryViewer: Story = { render: () => <HistoryMockup viewOnly /> };
export const HistoryUnsaved: Story = { render: () => <HistoryMockup saveState="failed" /> };
export const HistoryNaming: Story = {
  render: () => <HistoryMockup />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Name this version…' }),
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
export const SignIn: Story = { render: () => <EntryMockup /> };
export const Setup: Story = { render: () => <EntryMockup kind="setup" /> };
export const Invite: Story = { render: () => <EntryMockup kind="invite" /> };
export const Recovery: Story = { render: () => <EntryMockup kind="recovery" /> };
export const Consent: Story = { render: () => <EntryMockup kind="consent" /> };
export const ConsentExpired: Story = { render: () => <EntryMockup kind="consent-expired" /> };
export const GuestViewer: Story = { render: () => <EditorMockup guest viewOnly /> };
export const GuestEditor: Story = { render: () => <EditorMockup guest /> };
export const RevokedLink: Story = { render: () => <EntryMockup kind="revoked" /> };
export const OfflineLaunch: Story = { render: () => <EntryMockup kind="offline" /> };
export const MissingFile: Story = { render: () => <EntryMockup kind="missing" /> };
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
export const NoMatches: Story = { render: () => <DashboardMockup state="no-results" /> };
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
