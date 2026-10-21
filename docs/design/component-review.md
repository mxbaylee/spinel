# Component, section and journey review

Status: **in progress; no whole-product grade**. The earlier 96 scores applied to sampled composed views and must not be used as catalog-wide completion or acceptance. Owner requested this stricter review in chat, 2026-10-20.

Inventory baseline: commit `f9cdff3af5d3e99455255aaf7274e15053e4ccef` contains **35 existing story families and 45 total families** (nine Redesign families plus the new Favicon family). One family means one story file/meta title. Earlier “44 families” reporting was inaccurate. Subsequent new families are listed separately until a fresh build regenerates the inventory.

A baseline screenshot is a comparison, not a redesigned equivalent. A changed label or catalog group does not count as UI work. “State coverage present” means source specimens exist, not that visual/interaction review is complete. Production migration remains separate; the proposal must still specify every in-scope behavior.

For each component, acceptance needs exact current stories, light/dark/phone inspection, relevant keyboard/touch/pending/error/empty behavior, and a finding disposition. Section reviews assess composition and transitions. Persona reviews run after component gaps are reconciled. An unresolved gap cannot disappear into an average score.

## Identity/Entity icons

**Reused.** Actual EntityIcon artwork is embedded in file rows. Review dark/phone and long-title context.

Source: [src/ui/EntityIcon.stories.tsx](../../src/ui/EntityIcon.stories.tsx). Baseline family: yes.

States inventoried: Standalone, Lineup, InContext, Monochrome, Phone.

## Identity/Favicon

**Changed.** Tight framing and automatic theme variants; dark rotation rendered at 16/32/64px. Fresh CI evidence pending.

Source: [src/ui/Favicon.stories.tsx](../../src/ui/Favicon.stories.tsx). Baseline family: no.

States inventoried: Light, Dark, Automatic.

## Current production/Editor/FillPresets

**Intentionally removed.** Owner chose native Univer fill. Baseline remains for comparison; production removal belongs to migration.

Source: [src/ui/FillPresets.stories.tsx](../../src/ui/FillPresets.stories.tsx). Baseline family: yes.

States inventoried: Default, Disabled, Applying, Failed.

## Current production/Shell/GemLogo

**Reused with changed activation.** Actual artwork reused; new tap replay helper used in preview. Production callers unchanged. Repeated-tap/reduced-motion story added.

Source: [src/ui/GemLogo.stories.tsx](../../src/ui/GemLogo.stories.tsx). Baseline family: yes.

States inventoried: Rail, Large, TapReplay.

## Identity/Social cards

**Retained baseline.** Existing generated cards remain; verify all seven variants before retaining without changes.

Source: [src/ui/SocialCards.stories.tsx](../../src/ui/SocialCards.stories.tsx). Baseline family: yes.

States inventoried: Generic, Document, Spreadsheet, Emoji, LongTitle, LongWord, SpacePreview.

## Current production/Settings/ThemeSettings

**Implemented proposal; rendered review pending.** ThemeMenu uses the actual preference store. New blocked-storage story verifies the live theme changes while the saved value stays unchanged, with warning and cleanup.

Source: [src/ui/ThemeSettings.stories.tsx](../../src/ui/ThemeSettings.stories.tsx). Baseline family: yes.

States inventoried: Default, FollowSystem, StorageBlocked.

## Redesign/Controls

**Changed; demo repaired, unverified.** Base UI controls. Replaced unrelated theme selector inside Trash dialog with coherent Move/Destination example.

Source: [src/ui/redesign/Controls.stories.tsx](../../src/ui/redesign/Controls.stories.tsx). Baseline family: no.

States inventoried: Default, Disabled, Error.

## Redesign/File dialogs

**Implemented proposal; rendered review pending.** FileMutation adds create/rename/move/file-into-folder pending/error/retry, retained drafts and original placement. FolderSharing enforces account-only folder access.

Source: [src/ui/redesign/DashboardActions.stories.tsx](../../src/ui/redesign/DashboardActions.stories.tsx). Baseline family: no.

States inventoried: CreateDoc, Rename, Move, FileIntoFolder, Tags, Share, DeletePermanently, EmptyTrash, EmptyShared.

## Redesign/Editor recovery

**Partial.** History load/empty/error and export failure exist; component-specific mutation gaps are tracked above.

Source: [src/ui/redesign/EditorStates.stories.tsx](../../src/ui/redesign/EditorStates.stories.tsx). Baseline family: no.

States inventoried: HistoryLoading, HistoryEmpty, HistoryError, ExportPreparing, ExportFailed, OfflineSaveFailed.

## Redesign/Import file

**Proposed state coverage present.** See ImportFile mapping; no independent completion claim.

Source: [src/ui/redesign/ImportReview.stories.tsx](../../src/ui/redesign/ImportReview.stories.tsx). Baseline family: no.

States inventoried: Default, LimitsOpen, UnsupportedFile, NotJson, TooManyFiles, Importing, ImportFailed, Completed.

## Redesign/Screens

**Partial compositions.** Composed screens do not establish embedded component parity. Follow component rows and section review.

Source: [src/ui/redesign/Mockups.stories.tsx](../../src/ui/redesign/Mockups.stories.tsx). Baseline family: no.

States inventoried: Dashboard, SidebarLongDisplayName, EmptyFolder, LoadingFiles, FileError, Search, SharedFiles, Trash, Doc, FileIconHint, Sheet, ViewOnly, OfflineEditor, FormulaInContext, Formula, History, HistoryViewer, HistoryUnsaved, HistorySaving, HistoryOffline, HistoryNaming, Sharing, PlannedFileAdmin, Profile, Connections, ThisDevice, Admin, AdminLoading, AdminError, SignIn, Setup, Invite, Recovery, Consent, ConsentExpired, GuestViewer, GuestEditor, RevokedLink, OfflineLaunch, MissingFile, PlannedSpace, PlannedSpaceGuest, Passkeys, AdminInvites, AdminConnections, AdminHealth, FormulaPrivate, FormulaOffline, FormulaInvalid, FormulaLoading, FormulaEmpty, FormulaTable, HistoryCalendar, AdvancedSearch, NoMatches, FilteredNoMatches, PlannedSpaceGuestEditor, PlannedSpaceTrash, FormulaTableInContext, SharingCreatedLink, SharingExistingLink, SharingReplaceLink, SharingError, ConsentReadOnly, PlannedGuestLinks, DashboardCollapsed, Folder, CollaboratorSheet, PlannedSpaceCollapsed, GuestSheet, GuestLongTitle, AdminInviteCreated, AdminHealthWarning, AdminDisable, AdminPasskeys, HistoryRestore, PlannedSpaceViewer, PlannedSpaceDeepTree, DashboardGrid, DashboardGridCollapsed, DashboardNewMenu, ProfileIconPicker, ProfileColorPicker.

## Redesign/Native editors

**Changed; targeted visual evidence.** Real OSS Univer; bounded viewport and viewer fences. 390×600 deployed Doc inspected after scrolling; full CI pending.

Source: [src/ui/redesign/NativeEditors.stories.tsx](../../src/ui/redesign/NativeEditors.stories.tsx). Baseline family: no.

States inventoried: Sheet, Doc, SheetViewer, DocViewer, SheetFormula.

## Redesign/Review states

**Partial aggregate.** Presence of named recovery specimens does not certify absent component states.

Source: [src/ui/redesign/ReviewStates.stories.tsx](../../src/ui/redesign/ReviewStates.stories.tsx). Baseline family: no.

States inventoried: ProfileLoading, ProfileLoadError, ProfileSaving, ProfileSaveError, BackupRunning, BackupFailed, BackupUnconfigured, BackupLoadError, BackupLoading, BackupNeverRun, ConsentLoading, ConsentLoadError, ConsentPending, ConsentCancelling, ConsentError, ConsentOperator, ConsentMalformed, ConsentUnavailable, ConsentLimit.

## Redesign/Access tokens

**Proposed state coverage present.** See personal/Admin AccessTokens mapping; CI and manual review required.

Source: [src/ui/redesign/TokenManager.stories.tsx](../../src/ui/redesign/TokenManager.stories.tsx). Baseline family: no.

States inventoried: Loaded, Empty, Loading, LoadFailed, Creating, Created, CreateFailed, Revoking, Revoked, RevokeFailed, ActiveLimit, PreviouslyUsed, Copied, ManualCopy, OperatorMetadata, OperatorEmpty, OperatorLoading, OperatorLoadFailed, LongName.

## Redesign/Walkthrough

**Partial end-to-end proposal.** Main persona journeys connected; unresolved component states remain. Local fixtures simulate auth/save/sharing, not production integration.

Source: [src/ui/redesign/Walkthrough.stories.tsx](../../src/ui/redesign/Walkthrough.stories.tsx). Baseline family: no.

States inventoried: Owner, Collaborator, Operator, ReturningOperator, LinkGuest, Homepage, SignIn, PasskeyPending, SignInCancelled, SignInError, Invitation, Recovery, InvalidSetup, Settings, Administration, Sheet, Doc, SheetFullEditor, DocFullEditor, OperatorHelp.

## Current production/Settings/AccessTokens

**Proposed state coverage present.** TokenManager maps personal and Operator baseline states. Per-state rendered review and interaction evidence still required.

Source: [web/AccessTokens.stories.tsx](../../web/AccessTokens.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, Loading, LoadFailed, Creating, Created, CreateFailed, Revoking, Revoked, RevokeFailed, ActiveLimit, PreviouslyUsed, Copied, ManualCopy.

## Current production/Admin/AccessTokens

**Proposed state coverage present.** TokenManager maps personal and Operator baseline states. Per-state rendered review and interaction evidence still required.

Source: [web/AdminAccessTokens.stories.tsx](../../web/AdminAccessTokens.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, Loading, LoadFailed.

## Current production/Admin/AdminInvites

**Implemented proposal; rendered review pending.** Explicit pending/failure/retry for create/revoke, retained choices on failure, and used/expired/revoked fixtures added in AdminActions.

Source: [web/AdminInvites.stories.tsx](../../web/AdminInvites.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, RecoveryInvite, InviteCreated, LoadFailed, CreateFailed.

## Current production/Admin/AdminUsers

**Implemented proposal; rendered review pending.** Disable/passkey-removal pending/failure/retry, last-Operator credential protection and consequences added in AdminActions. Multi-passkey Operator removal keeps a remaining credential protected.

Source: [web/AdminUsers.stories.tsx](../../web/AdminUsers.stories.tsx). Baseline family: yes.

States inventoried: Loaded, LastAdminPasskey, LoadFailed, ConfirmDisable, ConfirmPasskeyRemoval, RemovalFailed.

## Current production/Shell/AppLayout

**Changed composition; rendered review pending.** Optional sidebar/compact site navigation and responsive focus handling now share real proposal pin state. Local-mode composition added; native editor viewport evidence must be refreshed.

Source: [web/AppLayout.stories.tsx](../../web/AppLayout.stories.tsx). Baseline family: yes.

States inventoried: Desktop, Tablet, Phone.

## Current production/Settings/AssistantConnections

**Repair implemented; unverified.** New ConnectionsReview reuses all13 baseline contracts in16 stories. Failure preserves active access; duplicate clients differentiated by origin. Integrated into Settings/Admin; CI/review pending.

Source: [web/AssistantConnections.stories.tsx](../../web/AssistantConnections.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, Loading, LoadFailed, Disconnecting, Disconnected, DisconnectFailed, MatchingNames, PreviouslyUsed, AdminMetadata, AdminEmpty, AdminLoading, AdminLoadFailed.

## Current production/Admin/BackupStatus

**Proposed state coverage present.** Eight health/loading/error variants are present. Per-state rendered review still required.

Source: [web/BackupStatus.stories.tsx](../../web/BackupStatus.stories.tsx). Baseline family: yes.

States inventoried: Healthy, Running, NeverRun, Overdue, Failed, NotConfigured, Loading, LoadFailed.

## Current production/Editor/Collaborators

**Implemented proposal; rendered review pending.** PresenceReview replaces the fixed avatar with a people/count trigger, scoped member/anonymous guest lists, empty/alone/many/long-name states and explicit simulated navigation. Integrated into editor headers; phone presence is visible.

Source: [web/Collaborators.stories.tsx](../../web/Collaborators.stories.tsx). Baseline family: yes.

States inventoried: Empty, Alone, TwoPeople, GuestLabels, Many.

## Current production/Settings/ConnectAssistant

**Proposed states present; rendered review pending.** ConsentExpiredBeforeAllow explicitly removes grant controls when the request expires. Outgoing redirects are intentionally simulated in the design harness; copy directs the person back to their application.

Source: [web/ConnectAssistant.stories.tsx](../../web/ConnectAssistant.stories.tsx). Baseline family: yes.

States inventoried: Consent, ReadOnly, Loading, LoadFailed, Expired, Unavailable, MissingRequest, AdminAccount, Allowing, Cancelling, SubmitFailed, ExpiredBeforeAllow, ConnectionLimit.

## Current production/Dashboard/Dashboard

**Implemented retrieval proposal; rendered review pending.** FilesRecovery adds shared loading/error, member local mode, last sync, no local data, unavailable rows and unopened offline folder. FileMutation adds create/rename/move/file-into-folder pending/failure fixtures, retained draft/destination and retry; rendered interaction review remains.

Source: [web/Dashboard.stories.tsx](../../web/Dashboard.stories.tsx). Baseline family: yes.

States inventoried: Populated, NewItem, NewDoc, NewSheet, EmptyWorkspace, SharedDrawer, SharedDrawerLoading, InsideFolder, Loading, LoadFailed, LocalMode, LocalNeedsConnection, LocalFolderNotOpened.

## Current production/Docs/Formulas

**Implemented authoring proposal; rendered review pending.** FormulaReview reuses completion helpers and the actual result renderer, with source selection, edit, keyboard autocomplete, pagination and all baseline failure states. Values are explicitly sample results; no duplicate formula engine or production integration.

Source: [web/DocFormulas.stories.tsx](../../web/DocFormulas.stories.tsx). Baseline family: yes.

States inventoried: Insert, Edit, LoadingSources, NoSources, SourceError, Dark, Phone, Scalar, Table, ThirtyRows, Empty, Calculating, PrivateSource, MissingSource, InvalidFormula, TooLarge, Busy, TimedOut, Unavailable.

## Current production/Docs/Native formulas

**Retained renderer; evidence pending.** Real native formula renderer is exercised with readiness assertions. Does not establish authoring-form redesign.

Source: [web/DocFormulasNative.stories.tsx](../../web/DocFormulasNative.stories.tsx). Baseline family: yes.

States inventoried: InlineAndTable, Private, Dark, Phone, ThirtyRows, StyledScalar.

## Current production/Dashboard/DocumentTags

**Implemented proposal; rendered review pending.** TagsReview replaces the comma-separated field, preserves valid commas inside tags, uses the production normalized 64-character limit, and covers suggestions/pending/add/remove failures with draft retention. Folder tag actions removed to match production.

Source: [web/DocumentTags.stories.tsx](../../web/DocumentTags.stories.tsx). Baseline family: yes.

States inventoried: NoTags, SeveralTags, SuggestionsFailed, Adding, AddFailed.

## Current production/Editor/FileExports

**Implemented state proposal; rendered review pending.** Added PDF-specific failure/retry, unsaved and offline specimens. Native export remains simulated; format copy explains editable Univer files and PDF print flow.

Source: [web/FileExports.stories.tsx](../../web/FileExports.stories.tsx). Baseline family: yes.

States inventoried: Saved, Unsaved, DownloadFailed, PrintFailed.

## Current production/Guest/GuestApp

**Proposed states present; integration review pending.** GuestEntryReview adds authorization loading and unsupported-browser guards with actual production copy, no identity or premature editor. These are isolated specimens; connected revocation/offline/native editor flow remains separate.

Source: [web/GuestApp.stories.tsx](../../web/GuestApp.stories.tsx). Baseline family: yes.

States inventoried: Loading, LinkRevoked, ConnectionInterrupted, UnsupportedBrowser.

## Current production/Account/Icon picker

**Reused.** Actual IconPicker embedded in ProfileMockup. Review search/category/phone/focus return in new context.

Source: [web/IconPicker.stories.tsx](../../web/IconPicker.stories.tsx). Baseline family: yes.

States inventoried: Browse.

## Current production/Dashboard/ImportFile

**Proposed state coverage present.** ImportDialog maps all baseline states plus completion. Validate each rendered state and interaction.

Source: [web/ImportFile.stories.tsx](../../web/ImportFile.stories.tsx). Baseline family: yes.

States inventoried: Default, LimitsOpen, UnsupportedFile, NotJson, TooManyFiles, Importing, ImportFailed.

## Current production/Dashboard/OfflineBadge

**Implemented local-mode proposal; rendered review pending.** Downloaded/unavailable rows, last-sync timestamp, no local data and unopened folder are represented. Local mode hides mutating controls and opens only available files read-only; no actual device storage is read.

Source: [web/OfflineStatus.stories.tsx](../../web/OfflineStatus.stories.tsx). Baseline family: yes.

States inventoried: Available, NeedsConnection, None, Banner, Unreachable.

## Current production/Dashboard/PinButton

**Implemented proposal; rendered review pending.** Local pin/unpin, pending/failure/retry now replace the disabled action. Dashboard and connected navigation share stable file IDs and pin state.

Source: [web/PinButton.stories.tsx](../../web/PinButton.stories.tsx). Baseline family: yes.

States inventoried: Unpinned, Pinned, Loading, LoadFailed.

## Current production/Dashboard/PinnedSidebar

**Implemented proposal; rendered review pending.** PinsReview provides empty/loading/error/retry, accessible reorder/unpin, compact navigation and folder pins. Shared provider preserves state across the connected journey and resets with the journey.

Source: [web/PinnedSidebar.stories.tsx](../../web/PinnedSidebar.stories.tsx). Baseline family: yes.

States inventoried: Pinned, Empty, Loading, LoadFailed.

## Current production/Editor/Profile cursor label

**Reused; contextual rendered review pending.** PresenceReview stories use the actual PresenceLabel with profile glyphs, long names and editor-context specimens. No replacement cursor renderer is claimed.

Source: [web/PresenceLabel.stories.tsx](../../web/PresenceLabel.stories.tsx). Baseline family: yes.

States inventoried: Flower, Cat.

## Current production/Account/Profile

**Proposed state coverage present.** Ready/loading/load-error/saving/save-error with retained draft and retry. Backend migration remains separate.

Source: [web/ProfileSettings.stories.tsx](../../web/ProfileSettings.stories.tsx). Baseline family: yes.

States inventoried: Ready, Loading, LoadError, SaveError, Saving.

## Current production/Shell/Rail

**Changed composition.** Member/Operator/signed-out and phone navigation mapped to Shell/EntryJourney. Render/context review pending.

Source: [web/Rail.stories.tsx](../../web/Rail.stories.tsx). Baseline family: yes.

States inventoried: Member, Admin, Phone, SignedOut.

## Current production/Dashboard/SearchPanel

**Implemented recovery proposal; rendered review pending.** Search pending retains loaded matches; failure hides stale results and retry keeps query. Result owner/path metadata is present. Query-token parser remains explicitly deferred to SPN-048.

Source: [web/SearchPanel.stories.tsx](../../web/SearchPanel.stories.tsx). Baseline family: yes.

States inventoried: EmptyQuery, Results, NoResults, Loading, Failed.

## Current production/Sharing/ShareLink

**Implemented proposal; rendered review pending.** SharingReview adds independent loading/load error, create/replace/revoke pending and failure states. Retry preserves prior permissions until completion; once-only address and replacement confirmation remain.

Source: [web/ShareLink.stories.tsx](../../web/ShareLink.stories.tsx). Baseline family: yes.

States inventoried: Loading, LinkOff, LinkOnViewOnly, LinkOnCanEdit, LinkOnWithoutUrl, Failed.

## Current production/Dashboard/SharedBadge

**Implemented metadata proposal; rendered review pending.** Shared rows show owner identity and unknown-owner fallback in FilesRecovery specimens.

Source: [web/SharedBadge.stories.tsx](../../web/SharedBadge.stories.tsx). Baseline family: yes.

States inventoried: Owned, SharedWithMe, UnknownOwner.

## Current production/Sharing/Sharing

**Implemented proposal; rendered review pending.** SharingReview covers loading/load failure, owner only, disabled account removal, staged direct-access choices, pending/failure/retry preserving confirmed access. Folder public links removed; actual folder-row flow has an assertion.

Source: [web/Sharing.stories.tsx](../../web/Sharing.stories.tsx). Baseline family: yes.

States inventoried: Loading, OwnerOnly, WithPeople, Folder, Failed.

## Current production/Dashboard/TagLabels

**Implemented proposal; rendered review pending.** TagLabelsReview renders two tags plus overflow count and full accessible text; empty/one/several/long specimens and Dashboard integration exist.

Source: [web/TagLabels.stories.tsx](../../web/TagLabels.stories.tsx). Baseline family: yes.

States inventoried: None, One, Several.

## Current production/Dashboard/Trash

**Implemented recovery proposal; rendered review pending.** Loading/failure/retry, retention expiry, named/count-confirmed Empty Trash, restore/delete/empty pending and failure preserve rows until successful retry.

Source: [web/Trash.stories.tsx](../../web/Trash.stories.tsx). Baseline family: yes.

States inventoried: WithItems, Empty, Loading, LoadFailed, ConfirmEmpty.

## Current production/Editor/VersionNames

**Implemented proposal; rendered review pending.** VersionNamesReview covers current/older naming, rename/remove, retention copy, viewer/empty/loading/error/pending/retry. Both History layouts use it; checkpoint names persist per file in the connected journey. Four History action stories verify current-vs-older naming and preview updates.

Source: [web/VersionNames.stories.tsx](../../web/VersionNames.stories.tsx). Baseline family: yes.

States inventoried: Closed, Open, ViewerOpen, NoVersions, UnsavedChanges, Loading, LoadFailed, NamingVersion.

## Added during this audit

These new families contain source specimens; none is accepted solely from its existence.

- **Redesign/Version names**: [source](../../src/ui/redesign/VersionNamesReview.stories.tsx); 22 stories: Ready, Viewer, Empty, Loading, LoadError, NameCurrent, NameOlder, Rename, Remove, Removing, RemoveError, Saving, SaveError, Unsaved, UnsavedDraft, Offline, Embedded, EmbeddedRename, LongName, RetrySave, RetryLoad, Removed.
- **Redesign/Connections**: [source](../../src/ui/redesign/ConnectionsReview.stories.tsx); 16 stories: Loaded, Empty, Loading, LoadFailed, Disconnecting, Disconnected, DisconnectFailed, MatchingNames, PreviouslyUsed, OperatorMetadata, OperatorEmpty, OperatorLoading, OperatorLoadFailed, RetryLoad, RetryDisconnect, DisconnectMatchingClient.
- **Redesign/Presence**: [source](../../src/ui/redesign/PresenceReview.stories.tsx); 16 stories: Empty, Alone, TwoPeople, PeopleOpen, AloneOpen, GuestLabels, Many, ManyOpen, LongName, JumpToPerson, NoSharedPosition, CursorLabelsInContext, EditorHeader, EditorPeopleOpen, GuestHeader, SimulatedEditorJump.
- **Redesign/Personal tags**: [source](../../src/ui/redesign/TagsReview.stories.tsx); 13 stories: NoTags, SeveralTags, SuggestionsLoading, SuggestionsFailed, Adding, AddFailed, Removing, RemoveFailed, LongAndMany, RetryAdd, TypeWithoutSuggestions, RetryRemove, ValidationKeepsDraft.
- **Redesign/Tag labels**: [source](../../src/ui/redesign/TagLabelsReview.stories.tsx); 4 stories: None, One, Several, Long.
- **Redesign/Pins**: [source](../../src/ui/redesign/PinsReview.stories.tsx); 20 stories: Loaded, Empty, Loading, LoadFailed, Pending, UpdateFailed, Compact, CompactEmpty, CompactLoading, CompactLoadFailed, CompactPending, CompactUpdateFailed, PinAndUnpin, ReorderAndRemoveFolder, RetryLoad, RetryUpdate, DashboardNavigation, RenameDuringPendingUpdate, TrashDuringPendingUpdate, TrashBeforeRetryUpdate.
- **Redesign/Formula authoring**: [source](../../src/ui/redesign/FormulaReview.stories.tsx); 34 stories: Insert, Edit, LoadingSources, NoSources, SourceError, SourceRetry, LoadingWorksheets, WorksheetError, WorksheetRetry, Dark, Phone, Scalar, Table, ThirtyRows, LastTablePage, Empty, Calculating, PrivateSource, MissingSource, InvalidFormula, TooLarge, Busy, TimedOut, Unavailable, PreviewRetry, Offline, Saving, SaveError, SaveRetry, Autocomplete, KeyboardCompletion, SourcePicker, EditedExpressionClearsPreview, Cancel.
- **Redesign/Sharing access**: [source](../../src/ui/redesign/SharingReview.stories.tsx); 21 stories: WithPeople, Loading, LoadFailed, OwnerOnly, DisabledAccount, UpdatingAccess, AccessFailed, Folder, LinkLoading, LinkLoadFailed, LinkOnViewOnly, LinkOnCanEdit, CreatingLink, CreateFailed, ReplacingLink, ReplaceFailed, RevokingLink, RevokeFailed, RetryAccess, RetryRevoke, RetryReplace.
- **Redesign/Operator actions**: [source](../../src/ui/redesign/AdminActions.stories.tsx); 27 stories: Accounts, AccountsLoading, AccountsFailed, InvitesLoading, InvitesFailed, InvitesEmpty, InvitationStatuses, InviteCreating, InviteCreateFailed, InviteRevoking, InviteRevokeFailed, DisablePending, DisableFailed, RemovePasskey, RemovePasskeyPending, RemovePasskeyFailed, ProtectedOperatorPasskey, ConnectionsLoading, ConnectionsFailed, RetryInvitesLoad, RetryCreateInvite, RetryDisable, RetryRemovePasskey, CancelFailedPasskeyRemoval, RetryRevokeInvite, OperatorWithMultiplePasskeys, RemoveOneOperatorPasskey.
- **Redesign/History actions**: [source](../../src/ui/redesign/HistoryActions.stories.tsx); 4 stories: RenameCheckpoint, RenamedCheckpoint, RemoveCheckpointName, OlderNamesWhileUnsaved.
- **Redesign/Entry states**: [source](../../src/ui/redesign/EntryStates.stories.tsx); 13 stories: InvitePending, InviteCancelled, InviteError, InviteInvalid, RecoveryPending, RecoveryCancelled, RecoveryError, RecoveryInvalid, SetupPending, SetupCancelled, SetupError, SetupInvalid, InviteCancelAndRetry.
- **Redesign/Guest entry**: [source](../../src/ui/redesign/GuestEntryReview.stories.tsx); 2 stories: AuthLoading, UnsupportedBrowser.
- **Redesign/Theme control**: [source](../../src/ui/redesign/ThemeMenu.stories.tsx); 2 stories: Default, StorageBlocked.
- **Redesign/File recovery**: [source](../../src/ui/redesign/FilesRecovery.stories.tsx); 27 stories: SharedLoading, SharedError, SharedUnknownOwner, SearchPending, SearchError, LocalMode, LocalNoData, LocalNavigationKeepsPinActionsDisabled, LocalFolderNotOpened, TrashLoading, TrashError, TrashExpired, EmptyTrashConfirmation, EmptyTrashPending, EmptyTrashFailed, RestorePending, RestoreFailed, DeletePending, DeleteFailed, RetrySearch, RetryShared, RetryTrash, RetryRestore, RetryDelete, RetryEmptyTrash, CancelEmptyTrash, ExpiredRestoreUnavailable.
- **Redesign/File mutations**: [source](../../src/ui/redesign/FileMutation.stories.tsx); 15 stories: CreatePending, CreateFailed, RenamePending, RenameFailed, MovePending, MoveFailed, FileIntoFolderPending, FileIntoFolderFailed, RetryCreate, RetryRename, RetryMove, RetryFileIntoFolder, CancelFailedRename, FailedMoveKeepsOriginalFolder, FailedFilingKeepsOriginalPlacement.
- **Redesign/Profile icon picker**: [source](../../src/ui/redesign/IconPickerReview.stories.tsx); 10 stories: Browse, Search, NoResults, Category, ShowMore, KeyboardNavigation, SelectedIcon, KeyboardSelectAndReturn, CancelAndReturn, NativeCancelAndReturn.

## Section review gates

- **Files/retrieval:** component repairs implemented — pins/tags, local availability/search/trash recovery added; rendered review remains. All new mutation specimens still require rendered interaction review.
- **Entry/authentication:** explicit setup/invite/recovery outcomes and guest capability/loading specimens added; verify every render and transition.
- **Editor/sharing/history:** component repairs implemented; full composed/rendered review remains. Formula insertion/export/presence jumps are explicitly simulated.
- **Settings/connections:** component repairs implemented; rendered review remains. Passkey rename/remove remain explicitly planned in SPN-070, not claimed as implemented.
- **Administration:** account/invite mutation proposals added; verify protected Operator and metadata-only access across all states.
- **Guests/Spaces:** initial capability/loading guards added; planned Space action dialogs and guest-link inventory remain illustrative future-feature scope, not existing production parity.

## Evidence and review provenance

- Source audits: independent reviewer compared all35 existing families; UI reviewer audited editor/shared controls; UX reviewer audited six product sections and all four personas.
- App CI for f9cdff3 passed all six required gates. Storybook run39549253667 produced 1,935 captures and104 explicit verifications but failed nine responsive Sheet toolbar checks. The compact mobile toolbar exists; its selector has been corrected in the working tree. This failed run does not validate the new component repairs.
- Deployed Doc was manually scrolled at855px and390×600: native toolbar stays visible; title/save header remains. Native mobile Doc still needs horizontal pan/zoom.
- Existing checked-in gallery is historical until refreshed. No owner approval, whole-product score or merge readiness is claimed.

## Independent source findings during repair

- **P2, fixed:** pending pin updates/retries could overwrite a rename or reintroduce a trashed item. Timer commits now reconcile against the latest catalog; three regression stories cover rename, trash and failed-update retry.
- **P2, fixed:** the phone navigation dialog omitted offline state, enabling pin mutations. Sidebar receives offline state; FilesRecovery checks disabled pin actions in phone/desktop navigation.
- **Specimen gap, filled:** Operator with multiple passkeys can remove one while retaining a protected credential. Added a fixture and interaction story.
- **Remaining visual question:** search/type and Filters/view switches currently occupy separate rows. The UX review recommends one responsive search/Filters/view toolbar, with Type inside Filters. Query tokens and a search-help builder remain SPN-048. This layout recommendation is not yet accepted or implemented.

The independent reviewer found no further source blockers in the inspected component repairs. This is not a whole-product grade: all new story plays, keyboard restoration, touch geometry and screenshots require CI/rendered review.
