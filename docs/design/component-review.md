# Component, section and journey review

Status: **rendered component and section inspections completed for the evidence sets below; full stricter interaction CI passed on reviewed source; owner approved the proposal as-is on 2026-10-21**. This is not whole-product acceptance. The earlier 96 scores applied to sampled composed views and must not be used as catalog-wide completion. Owner requested this stricter review in chat, 2026-10-20.

Current source inventory after pin removal and loading additions: **59 families and 632 exported story specimens**. App CI **39567404022 passed** for `dc9170fa68243fa10ad34d700e0e8f9cf4471c40`, including all required gates. Focused final-source run **39567463871 passed 25 captures / 7 explicit checks**; reset run **39566541453 passed 10 captures / 10 checks** on `6a627c2`. Full Storybook run **39567403971 passed 3,160 captures and 118 explicit checks with zero failures** on the same source. The refreshed gallery contains 269 curated images, including 66 explicitly older comparison captures; per-image provenance is preserved. Earlier failed runs and superseded grades below remain historical evidence, not current interaction passes.

The current family summaries below reconcile the recorded reviews. All five variants means light, dark, phone, phone-dark and tablet. Reviewers screened the 97 states across editor-related families, 122 retrieval/administration/connection states, 40 entry/consent/theme/picker states, retained/shared controls and composed sections; focused runs replaced specified stale or intermediate renders. All five Tags-dialog final-state captures are now inspected; no old menu-only capture gap remains. The historical audit from “Historical evidence and repair provenance” onward is preserved with its original chronology.

Inventory baseline: commit `f9cdff3af5d3e99455255aaf7274e15053e4ccef` contains **35 existing story families and 45 total families** (nine Redesign families plus the new Favicon family). One family means one story file/meta title. Earlier “44 families” reporting was inaccurate. At `5655c2c`, the source catalog contained **61 families and 641 exported story specimens** (a source count, not a completed render count). The families added during this audit are listed below; the retired Pins family is retained only as a historical note.

A baseline screenshot is a comparison, not a redesigned equivalent. A changed label or catalog group does not count as UI work. “State coverage present” means source specimens exist, not that visual/interaction review is complete. Production migration remains separate; the proposal must still specify every in-scope behavior.

For each component, acceptance needs exact current stories, light/dark/phone inspection, relevant keyboard/touch/pending/error/empty behavior, and a finding disposition. Section reviews assess composition and transitions. Persona reviews run after component gaps are reconciled. An unresolved gap cannot disappear into an average score.

## Current scope change, 2026-10-21

The owner explicitly removed personal pinning and all pinned-item UI from this
branch. PinButton, PinnedSidebar and Redesign/Pins are retired feature specimens,
not required proposal states or migration work. Earlier pin-related review
results below are historical and cannot justify retaining the feature. Catalog
counts exclude the three removed pin families and include the new Loading family; current full capture run passed.
Review by subtraction also removes redundant Space-page Back controls and uses
icon-only My files in compact headers; see the playbook criterion.

## Identity/Entity icons

**Reused; visually inspected.** Actual EntityIcon artwork is embedded in file rows. Retained identity inspection covered all five variants, with file-row and long-title context reviewed in the composed retrieval screens. This is reuse, not a replacement component.

Source: [src/ui/EntityIcon.stories.tsx](../../src/ui/EntityIcon.stories.tsx). Baseline family: yes.

States inventoried: Standalone, Lineup, InContext, Monochrome, Phone.

## Identity/Favicon

**Changed; visually inspected.** Tight framing, automatic theme variants and dark rotation were inspected at 16/32/64px in the retained identity pass. No new favicon finding; this does not certify browser installation/cache behavior.

Source: [src/ui/Favicon.stories.tsx](../../src/ui/Favicon.stories.tsx). Baseline family: no.

States inventoried: Light, Dark, Automatic.

## Historical Editor/FillPresets (removed in SPN-050)

**Intentionally removed.** Owner chose native Univer fill; SPN-050 removed the
production control after this baseline comparison.

The baseline source and stories were removed in SPN-050. Use the native Sheet fill
menu; stored preset mappings and profile palette remain. This section records the
historical audit, not a current component. Baseline family: yes.

States inventoried: Default, Disabled, Applying, Failed.

## Current production/Shell/GemLogo

**Reused with changed activation; visually inspected.** Actual artwork and preview tap replay are represented in the five-variant identity pass. Repeated activation/reduced-motion stories exist; catalog-wide interaction validation passed on reviewed source. Production callers remain unchanged.

Source: [src/ui/GemLogo.stories.tsx](../../src/ui/GemLogo.stories.tsx). Baseline family: yes.

States inventoried: Rail, Large, TapReplay.

## Identity/Social cards

**Retained baseline; visually inspected.** All seven variants were retained after the identity pass, with a minor trailing-emoji cosmetic note. They were not redesigned or counted as replacement components.

Source: [src/ui/SocialCards.stories.tsx](../../src/ui/SocialCards.stories.tsx). Baseline family: yes.

States inventoried: Generic, Document, Spreadsheet, Emoji, LongTitle, LongWord, SpacePreview.

## Current production/Settings/ThemeSettings

**Baseline retained; proposal visually inspected.** ThemeMenu uses the actual preference store. Storage failure keeps the live theme and warns that persistence failed; the repaired dismissible warning has a dedicated story. The compact control is also verified in fresh entry compositions. Full interaction CI passed on reviewed source.

Source: [src/ui/ThemeSettings.stories.tsx](../../src/ui/ThemeSettings.stories.tsx). Baseline family: yes.

States inventoried: Default, FollowSystem, StorageBlocked.

## Redesign/Controls

**Changed; visually inspected in all five variants.** Base UI controls use a coherent Move/Destination example. Disabled/error states and coarse-pointer controls were reviewed with no new visual blocker; full interaction CI passed on reviewed source.

Source: [src/ui/redesign/Controls.stories.tsx](../../src/ui/redesign/Controls.stories.tsx). Baseline family: no.

States inventoried: Default, Disabled, Error.

## Redesign/File dialogs

**Proposal visually inspected in all five variants.** Fresh `dd286` renders cover create, rename, move, file-into-folder, share, folder sharing and permanent delete in all five variants. `c904` supplies the exact-tag-filter final state. The fresh `a521eca` focused set shows the actual Tags dialog in all five variants, replacing earlier prerequisite-menu captures. Folder access is account-only; pending/failure behavior is covered separately by File mutations.

Source: [src/ui/redesign/DashboardActions.stories.tsx](../../src/ui/redesign/DashboardActions.stories.tsx). Baseline family: no.

States inventoried: CreateDoc, Rename, Move, FileIntoFolder, Tags, PersonalTagsAndExactFilter, FolderHasNoTagsAction, Share, FolderSharing, DeletePermanently, EmptyTrash, EmptyShared.

## Redesign/Editor recovery

**Proposal visually inspected in all five variants.** History loading/empty/error and export/PDF/unsaved/offline recovery are represented. Fresh `dd286` confirms Reconnect is distinct from disabled save retry and retains unsaved status. Export and network transitions are local fixtures; full interaction CI passed on reviewed source.

Source: [src/ui/redesign/EditorStates.stories.tsx](../../src/ui/redesign/EditorStates.stories.tsx). Baseline family: no.

States inventoried: HistoryLoading, HistoryEmpty, HistoryError, ExportPreparing, ExportFailed, ExportPdfFailed, ExportUnsaved, ExportOffline, ExportPdfRetry, OfflineSaveFailed, OfflineReconnect.

## Redesign/Import file

**Proposal visually inspected in all five variants.** Eight states cover limits, validation, pending, failure and completion. Pending dismissal stays disabled with destination/status visible. Real import execution is outside this fixture review; full interaction CI passed on reviewed source.

Source: [src/ui/redesign/ImportReview.stories.tsx](../../src/ui/redesign/ImportReview.stories.tsx). Baseline family: no.

States inventoried: Default, LimitsOpen, UnsupportedFile, NotJson, TooManyFiles, Importing, ImportFailed, Completed.

## Redesign/Screens

**Compositions visually inspected in all five variants.** Files, entry, editor, history, sharing, settings, administration and planned Spaces received section review. Fresh focused renders verify entry theme controls, This device spacing and honest planned Space restoration. Illustrative editor screens do not substitute for native editor evidence; future-feature controls remain labeled planned.

Source: [src/ui/redesign/Mockups.stories.tsx](../../src/ui/redesign/Mockups.stories.tsx). Baseline family: no.

States inventoried: Dashboard, SidebarLongDisplayName, EmptyFolder, LoadingFiles, FileError, Search, SharedFiles, Trash, Doc, FileIconHint, Sheet, ViewOnly, OfflineEditor, FormulaInContext, Formula, History, HistoryViewer, HistoryUnsaved, HistorySaving, HistoryOffline, HistoryNaming, Sharing, PlannedFileAdmin, Profile, Connections, ThisDevice, Admin, AdminLoading, AdminError, SignIn, Setup, Invite, Recovery, Consent, ConsentExpired, GuestViewer, GuestEditor, RevokedLink, OfflineLaunch, MissingFile, PlannedSpace, PlannedSpaceGuest, Passkeys, AdminInvites, AdminConnections, AdminHealth, FormulaPrivate, FormulaOffline, FormulaInvalid, FormulaLoading, FormulaEmpty, FormulaTable, HistoryCalendar, AdvancedSearch, NoMatches, FilteredNoMatches, PlannedSpaceGuestEditor, PlannedSpaceTrash, FormulaTableInContext, SharingCreatedLink, SharingExistingLink, SharingReplaceLink, SharingError, ConsentReadOnly, PlannedGuestLinks, DashboardCollapsed, Folder, CollaboratorSheet, PlannedSpaceCollapsed, GuestSheet, GuestLongTitle, AdminInviteCreated, AdminHealthWarning, AdminDisable, AdminPasskeys, HistoryRestore, PlannedSpaceViewer, PlannedSpaceDeepTree, DashboardGrid, DashboardGridCollapsed, DashboardNewMenu, ProfileIconPicker, ProfileColorPicker.

## Redesign/Native editors

**Real OSS Univer; fresh visual and focused interaction evidence.** `dd286` supplies all five native stories in all five variants plus short-phone scroll checks. Skeleton/resize gaps have rendered replacements; the toolbar remains below app navigation. Native Docs still require horizontal scrolling on phones, retain white page content in dark mode and keep the title/action chrome visible. Full catalog CI passed on reviewed source.

Source: [src/ui/redesign/NativeEditors.stories.tsx](../../src/ui/redesign/NativeEditors.stories.tsx). Baseline family: no.

States inventoried: Sheet, Doc, SheetViewer, DocViewer, SheetFormula.

## Redesign/Review states

**Proposal visually inspected.** Profile/backup and consent specimens were screened in all five variants. Consent recovery now connects to Settings or the everyday-account journey; simulated authentication/network effects remain explicit. A named aggregate state is not evidence of unchanged production-component migration.

Source: [src/ui/redesign/ReviewStates.stories.tsx](../../src/ui/redesign/ReviewStates.stories.tsx). Baseline family: no.

States inventoried: ProfileLoading, ProfileLoadError, ProfileSaving, ProfileSaveError, BackupRunning, BackupFailed, BackupUnconfigured, BackupLoadError, BackupLoading, BackupNeverRun, ConsentLoading, ConsentLoadError, ConsentPending, ConsentCancelling, ConsentError, ConsentOperator, ConsentMalformed, ConsentUnavailable, ConsentLimit.

## Redesign/Access tokens

**Proposal visually inspected in all five variants.** All 19 personal/Operator states were reviewed, including manual copy, long names and pending dismissal. Operator metadata remains read-only. Full interaction CI passed on reviewed source; production token operations are not exercised by the proposal.

Source: [src/ui/redesign/TokenManager.stories.tsx](../../src/ui/redesign/TokenManager.stories.tsx). Baseline family: no.

States inventoried: Loaded, Empty, Loading, LoadFailed, Creating, Created, CreateFailed, Revoking, Revoked, RevokeFailed, ActiveLimit, PreviouslyUsed, Copied, ManualCopy, OperatorMetadata, OperatorEmpty, OperatorLoading, OperatorLoadFailed, LongName.

## Redesign/Walkthrough

**Connected proposal visually inspected, with focused interaction evidence.** Four-persona journeys and editor compositions were reviewed; fresh entry/Doc-return renders and `dd286` native/full-editor captures replace stale evidence. Local fixtures simulate auth/save/sharing and generic native document content. This is not production end-to-end validation or whole-product acceptance.

Source: [src/ui/redesign/Walkthrough.stories.tsx](../../src/ui/redesign/Walkthrough.stories.tsx). Baseline family: no.

States inventoried: Owner, Collaborator, Operator, ReturningOperator, LinkGuest, Homepage, SignIn, PasskeyPending, SignInCancelled, SignInError, Invitation, Recovery, InvalidSetup, Settings, Administration, Sheet, Doc, SheetFullEditor, DocFullEditor, OperatorHelp, DocReturnToFiles.

## Current production/Settings/AccessTokens

**Baseline unchanged; proposed equivalent visually inspected.** TokenManager covers the personal states in the 19-state five-variant review, including manual copy and failures. This does not mean the production component was migrated. Full interaction CI passed on reviewed source.

Source: [web/AccessTokens.stories.tsx](../../web/AccessTokens.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, Loading, LoadFailed, Creating, Created, CreateFailed, Revoking, Revoked, RevokeFailed, ActiveLimit, PreviouslyUsed, Copied, ManualCopy.

## Current production/Admin/AccessTokens

**Baseline unchanged; proposed equivalent visually inspected.** TokenManager retains read-only Operator metadata, empty/loading/error variants and no personal token controls. Full interaction CI passed on reviewed source.

Source: [web/AdminAccessTokens.stories.tsx](../../web/AdminAccessTokens.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, Loading, LoadFailed.

## Current production/Admin/AdminInvites

**Baseline unchanged; proposed equivalent visually inspected.** AdminActions covers create/revoke pending/failure/retry, retained choices and used/expired/revoked invitations in the 27-state five-variant review. Full interaction CI passed on reviewed source.

Source: [web/AdminInvites.stories.tsx](../../web/AdminInvites.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, RecoveryInvite, InviteCreated, LoadFailed, CreateFailed.

## Current production/Admin/AdminUsers

**Baseline unchanged; proposed equivalent visually inspected.** Disable/passkey-removal recovery and protected-last-credential behavior were reviewed. `c904` shows successful removal with the remaining Operator credential protected. Its narrow badge overflow is fixed at `00cc641`; focused run 39561831008 passed all ten captures, independently inspected without overflow. Full interaction CI passed on reviewed source.

Source: [web/AdminUsers.stories.tsx](../../web/AdminUsers.stories.tsx). Baseline family: yes.

States inventoried: Loaded, LastAdminPasskey, LoadFailed, ConfirmDisable, ConfirmPasskeyRemoval, RemovalFailed.

## Current production/Shell/AppLayout

**Baseline unchanged; proposed composition visually inspected.** Responsive site navigation, local mode and composed sections were reviewed. The earlier pin-specific navigation evidence is superseded by feature removal; `dd286` replaces old native viewport gaps. Production layout migration remains separate.

Source: [web/AppLayout.stories.tsx](../../web/AppLayout.stories.tsx). Baseline family: yes.

States inventoried: Desktop, Tablet, Phone.

## Current production/Settings/AssistantConnections

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** ConnectionsReview maps all 13 baseline contracts in 16 stories, including same-name origins and failed disconnect preserving active access. Settings/Admin compositions retain the metadata boundary. Full interaction CI passed on reviewed source.

Source: [web/AssistantConnections.stories.tsx](../../web/AssistantConnections.stories.tsx). Baseline family: yes.

States inventoried: Loaded, Empty, Loading, LoadFailed, Disconnecting, Disconnected, DisconnectFailed, MatchingNames, PreviouslyUsed, AdminMetadata, AdminEmpty, AdminLoading, AdminLoadFailed.

## Current production/Admin/BackupStatus

**Baseline unchanged; proposed equivalent visually inspected.** Eight health/loading/error variants and Administration context were reviewed, including the five-variant retained/shared pass. This does not exercise a backup or establish recovery correctness.

Source: [web/BackupStatus.stories.tsx](../../web/BackupStatus.stories.tsx). Baseline family: yes.

States inventoried: Healthy, Running, NeverRun, Overdue, Failed, NotConfigured, Loading, LoadFailed.

## Current production/Editor/Collaborators

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** PresenceReview replaces the fixed avatar with a people/count trigger and member/anonymous lists, alone/many/long-name states and simulated navigation. Phone presence is visible; full interaction CI passed on reviewed source.

Source: [web/Collaborators.stories.tsx](../../web/Collaborators.stories.tsx). Baseline family: yes.

States inventoried: Empty, Alone, TwoPeople, GuestLabels, Many.

## Current production/Settings/ConnectAssistant

**Baseline unchanged; proposed consent states visually inspected.** Expiry removes grant controls; limit recovery reaches Connections and returns; Operator recovery reaches everyday sign-in. Fresh entry captures show consistent theme controls. Outgoing redirects/authentication are simulated; full interaction CI passed on reviewed source.

Source: [web/ConnectAssistant.stories.tsx](../../web/ConnectAssistant.stories.tsx). Baseline family: yes.

States inventoried: Consent, ReadOnly, Loading, LoadFailed, Expired, Unavailable, MissingRequest, AdminAccount, Allowing, Cancelling, SubmitFailed, ExpiredBeforeAllow, ConnectionLimit.

## Current production/Dashboard/Dashboard

**Baseline unchanged; retrieval proposal visually inspected in all five variants.** FilesRecovery and FileMutation cover local availability, shared/search recovery and retained mutation drafts. Fresh focused renders cover owned-folder deletion/restoration and final file dialogs. All five final Tags-dialog renders are inspected, and full interaction CI passed on the reviewed source.

Source: [web/Dashboard.stories.tsx](../../web/Dashboard.stories.tsx). Baseline family: yes.

States inventoried: Populated, NewItem, NewDoc, NewSheet, EmptyWorkspace, SharedDrawer, SharedDrawerLoading, InsideFolder, Loading, LoadFailed, LocalMode, LocalNeedsConnection, LocalFolderNotOpened.

## Current production/Docs/Formulas

**Baseline unchanged; authoring proposal visually inspected in all five variants.** All 34 states cover source selection/editing/autocomplete/pagination and failures using completion helpers and the actual result renderer. Values remain sample results; no production engine/insertion integration is claimed. Full interaction CI passed on reviewed source.

Source: [web/DocFormulas.stories.tsx](../../web/DocFormulas.stories.tsx). Baseline family: yes.

States inventoried: Insert, Edit, LoadingSources, NoSources, SourceError, Dark, Phone, Scalar, Table, ThirtyRows, Empty, Calculating, PrivateSource, MissingSource, InvalidFormula, TooLarge, Busy, TimedOut, Unavailable.

## Current production/Docs/Native formulas

**Retained renderer, not redesigned authoring.** Native readiness assertions and real renderer specimens remain. Fresh `dd286` includes the native SheetFormula composition; this is not blanket acceptance of every unchanged baseline native-formula story.

Source: [web/DocFormulasNative.stories.tsx](../../web/DocFormulasNative.stories.tsx). Baseline family: yes.

States inventoried: InlineAndTable, Private, Dark, Phone, ThirtyRows, StyledScalar.

## Current production/Dashboard/DocumentTags

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** All 13 TagsReview states cover suggestions, pending/add/remove failures and retained drafts, with the production 64-character limit and literal commas preserved. The separate Dashboard Tags dialog now has all five final renders inspected.

Source: [web/DocumentTags.stories.tsx](../../web/DocumentTags.stories.tsx). Baseline family: yes.

States inventoried: NoTags, SeveralTags, SuggestionsFailed, Adding, AddFailed.

## Current production/Editor/FileExports

**Baseline unchanged; proposed recovery states visually inspected in all five variants.** PDF failure/retry, unsaved and offline specimens distinguish editable Univer files from print/PDF. Native export is simulated in this proposal; full interaction CI passed on reviewed source.

Source: [web/FileExports.stories.tsx](../../web/FileExports.stories.tsx). Baseline family: yes.

States inventoried: Saved, Unsaved, DownloadFailed, PrintFailed.

## Current production/Guest/GuestApp

**Baseline unchanged; proposed entry/context visually inspected.** Authorization loading and unsupported-browser guards avoid premature editor/identity disclosure. Fresh `22d60` verifies plain-language browser recovery; revoked/offline and native guest compositions were reviewed separately. Live revocation and authorization are not validated by local fixtures.

Source: [web/GuestApp.stories.tsx](../../web/GuestApp.stories.tsx). Baseline family: yes.

States inventoried: Loading, LinkRevoked, ConnectionInterrupted, UnsupportedBrowser.

## Current production/Account/Icon picker

**Actual picker reused; fresh context repair visually verified.** Five-variant context review covers search/category/keyboard/selection/focus return. Fresh `22d60` shows bounded Show more scrolling with search and Cancel visible, and Cancel returning focus. No replacement picker behavior is claimed.

Source: [web/IconPicker.stories.tsx](../../web/IconPicker.stories.tsx). Baseline family: yes.

States inventoried: Browse.

## Current production/Dashboard/ImportFile

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** ImportDialog maps all baseline states plus completion, with pending dismissal disabled and errors visible. File processing is simulated; full interaction CI passed on reviewed source.

Source: [web/ImportFile.stories.tsx](../../web/ImportFile.stories.tsx). Baseline family: yes.

States inventoried: Default, LimitsOpen, UnsupportedFile, NotJson, TooManyFiles, Importing, ImportFailed.

## Current production/Dashboard/OfflineBadge

**Baseline unchanged; local-mode proposal visually inspected in all five variants.** Available/unavailable rows, last sync, empty local data and unopened folders are distinct; unavailable mutations remain disabled in fresh phone/desktop navigation. No actual device storage is read.

Source: [web/OfflineStatus.stories.tsx](../../web/OfflineStatus.stories.tsx). Baseline family: yes.

States inventoried: Available, NeedsConnection, None, Banner, Unreachable.

## Current production/Dashboard/PinButton

**Retired by owner direction, 2026-10-21.** Personal pinning and its UI are removed from this branch. The earlier component inspection is historical evidence only; no replacement or migration is requested.

## Current production/Dashboard/PinnedSidebar

**Retired by owner direction, 2026-10-21.** Personal pinning and its UI are removed from this branch. The earlier component inspection is historical evidence only; no replacement or migration is requested.

## Current production/Editor/Profile cursor label

**Reused; contextual visual inspection complete.** Actual PresenceLabel appears in five-variant PresenceReview specimens with profile glyphs/long names. No replacement cursor renderer or live collaboration verification is claimed.

Source: [web/PresenceLabel.stories.tsx](../../web/PresenceLabel.stories.tsx). Baseline family: yes.

States inventoried: Flower, Cat.

## Current production/Account/Profile

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** Ready/loading/error/saving states preserve drafts and retry; actual picker reuse has fresh phone evidence. Backend persistence and production migration remain separate.

Source: [web/ProfileSettings.stories.tsx](../../web/ProfileSettings.stories.tsx). Baseline family: yes.

States inventoried: Ready, Loading, LoadError, SaveError, Saving.

## Current production/Shell/Rail

**Baseline unchanged; proposed composition visually inspected.** Member/Operator/signed-out and phone destinations were reviewed through Shell/EntryJourney. Fresh entry theme and offline navigation renders supplement the composition review; production callers are not migrated.

Source: [web/Rail.stories.tsx](../../web/Rail.stories.tsx). Baseline family: yes.

States inventoried: Member, Admin, Phone, SignedOut.

## Current production/Dashboard/SearchPanel

**Baseline unchanged; proposed recovery visually inspected in all five variants.** Pending retains local matches; failure hides stale results and preserves query for retry. One responsive toolbar groups Search/Filters/view controls, with scope above results. Query tokens/search-help builder remain SPN-048.

Source: [web/SearchPanel.stories.tsx](../../web/SearchPanel.stories.tsx). Baseline family: yes.

States inventoried: EmptyQuery, Results, NoResults, Loading, Failed.

## Current production/Sharing/ShareLink

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** SharingReview covers load/create/replace/revoke pending/failure, preserved permissions and once-only link handling. Fresh phone Share captures verify stacked actions. Real permission/link mutation remains simulated; full interaction CI passed on reviewed source.

Source: [web/ShareLink.stories.tsx](../../web/ShareLink.stories.tsx). Baseline family: yes.

States inventoried: Loading, LinkOff, LinkOnViewOnly, LinkOnCanEdit, LinkOnWithoutUrl, Failed.

## Current production/Dashboard/SharedBadge

**Baseline unchanged; metadata proposal visually inspected in all five variants.** FilesRecovery shared rows distinguish owner identity and unknown-owner fallback without adding redundant standalone controls.

Source: [web/SharedBadge.stories.tsx](../../web/SharedBadge.stories.tsx). Baseline family: yes.

States inventoried: Owned, SharedWithMe, UnknownOwner.

## Current production/Sharing/Sharing

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** Loading/failure, owner-only, disabled-account and staged direct-access states retain confirmed access/drafts on failure. Fresh folder-sharing renders omit public links, and phone Share renders confirm readable stacked controls. Full interaction CI passed on reviewed source.

Source: [web/Sharing.stories.tsx](../../web/Sharing.stories.tsx). Baseline family: yes.

States inventoried: Loading, OwnerOnly, WithPeople, Folder, Failed.

## Current production/Dashboard/TagLabels

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** Four TagLabelsReview states cap rows at two tags plus overflow count and retain full accessible text. Touch users still open Tags to read truncated full labels; static row hints are not a touch-discovery solution.

Source: [web/TagLabels.stories.tsx](../../web/TagLabels.stories.tsx). Baseline family: yes.

States inventoried: None, One, Several.

## Current production/Dashboard/Trash

**Baseline unchanged; proposed recovery visually inspected in all five variants.** Deadlines/expired status remain visible on narrow screens. Fresh folder fixtures verify owned-subtree consequences and coherent restored/deleted rows; pending/failure retains data. Full interaction CI passed on reviewed source.

Source: [web/Trash.stories.tsx](../../web/Trash.stories.tsx). Baseline family: yes.

States inventoried: WithItems, Empty, Loading, LoadFailed, ConfirmEmpty.

## Current production/Editor/VersionNames

**Baseline unchanged; proposed equivalent visually inspected in all five variants.** All 22 VersionNames states and four History action states cover current/older naming, rename/removal, retention and recovery. Fresh `c904` verifies final rename/remove dialogs and selected-name updates instead of prerequisite menus. Full interaction CI passed on reviewed source.

Source: [web/VersionNames.stories.tsx](../../web/VersionNames.stories.tsx). Baseline family: yes.

States inventoried: Closed, Open, ViewerOpen, NoVersions, UnsavedChanges, Loading, LoadFailed, NamingVersion.

## Added during this audit

These new families have recorded visual review, not just source inventory. The 97 editor states and 122 retrieval/administration/connection states were inspected in all five variants across partial light and subsequent full captures; 40 entry/consent/theme/picker states received the corresponding five-variant review. Focused runs provide the newer states and repairs described below. Older capture runs do not establish interaction success; full stricter CI passed on reviewed source.

- **Redesign/Version names**: [source](../../src/ui/redesign/VersionNamesReview.stories.tsx); 22 stories: Ready, Viewer, Empty, Loading, LoadError, NameCurrent, NameOlder, Rename, Remove, Removing, RemoveError, Saving, SaveError, Unsaved, UnsavedDraft, Offline, Embedded, EmbeddedRename, LongName, RetrySave, RetryLoad, Removed. **Review:** Five-variant inspection; fresh `c904` EmbeddedRename final state verified.
- **Redesign/Connections**: [source](../../src/ui/redesign/ConnectionsReview.stories.tsx); 16 stories: Loaded, Empty, Loading, LoadFailed, Disconnecting, Disconnected, DisconnectFailed, MatchingNames, PreviouslyUsed, OperatorMetadata, OperatorEmpty, OperatorLoading, OperatorLoadFailed, RetryLoad, RetryDisconnect, DisconnectMatchingClient. **Review:** All 16 states visually inspected in five variants; local mutation fixtures only.
- **Redesign/Presence**: [source](../../src/ui/redesign/PresenceReview.stories.tsx); 16 stories: Empty, Alone, TwoPeople, PeopleOpen, AloneOpen, GuestLabels, Many, ManyOpen, LongName, JumpToPerson, NoSharedPosition, CursorLabelsInContext, EditorHeader, EditorPeopleOpen, GuestHeader, SimulatedEditorJump. **Review:** All 16 states visually inspected in five variants; jumps are simulated.
- **Redesign/Personal tags**: [source](../../src/ui/redesign/TagsReview.stories.tsx); 13 stories: NoTags, SeveralTags, SuggestionsLoading, SuggestionsFailed, Adding, AddFailed, Removing, RemoveFailed, LongAndMany, RetryAdd, TypeWithoutSuggestions, RetryRemove, ValidationKeepsDraft. **Review:** All 13 states visually inspected in five variants; separate Dashboard Tags final-render gap remains.
- **Redesign/Tag labels**: [source](../../src/ui/redesign/TagLabelsReview.stories.tsx); 4 stories: None, One, Several, Long. **Review:** All four states visually inspected in five variants; full truncated labels require Tags on touch.
- **Redesign/Pins — retired:** the 20-state family was inspected before the owner removed personal pinning on 2026-10-21. It is no longer a current proposal family.
- **Redesign/Formula authoring**: [source](../../src/ui/redesign/FormulaReview.stories.tsx); 34 stories: Insert, Edit, LoadingSources, NoSources, SourceError, SourceRetry, LoadingWorksheets, WorksheetError, WorksheetRetry, Dark, Phone, Scalar, Table, ThirtyRows, LastTablePage, Empty, Calculating, PrivateSource, MissingSource, InvalidFormula, TooLarge, Busy, TimedOut, Unavailable, PreviewRetry, Offline, Saving, SaveError, SaveRetry, Autocomplete, KeyboardCompletion, SourcePicker, EditedExpressionClearsPreview, Cancel. **Review:** All 34 states visually inspected in five variants; result values and insertion remain simulated.
- **Redesign/Sharing access**: [source](../../src/ui/redesign/SharingReview.stories.tsx); 21 stories: WithPeople, Loading, LoadFailed, OwnerOnly, DisabledAccount, UpdatingAccess, AccessFailed, Folder, LinkLoading, LinkLoadFailed, LinkOnViewOnly, LinkOnCanEdit, CreatingLink, CreateFailed, ReplacingLink, ReplaceFailed, RevokingLink, RevokeFailed, RetryAccess, RetryRevoke, RetryReplace. **Review:** All 21 states visually inspected in five variants; fresh phone sharing renders verify action stacking.
- **Redesign/Operator actions**: [source](../../src/ui/redesign/AdminActions.stories.tsx); 27 stories: Accounts, AccountsLoading, AccountsFailed, InvitesLoading, InvitesFailed, InvitesEmpty, InvitationStatuses, InviteCreating, InviteCreateFailed, InviteRevoking, InviteRevokeFailed, DisablePending, DisableFailed, RemovePasskey, RemovePasskeyPending, RemovePasskeyFailed, ProtectedOperatorPasskey, ConnectionsLoading, ConnectionsFailed, RetryInvitesLoad, RetryCreateInvite, RetryDisable, RetryRemovePasskey, CancelFailedPasskeyRemoval, RetryRevokeInvite, OperatorWithMultiplePasskeys, RemoveOneOperatorPasskey. **Review:** All 27 states visually inspected in five variants; the remaining-passkey badge repair has ten passing, visually inspected `00cc641` captures.
- **Redesign/History actions**: [source](../../src/ui/redesign/HistoryActions.stories.tsx); 4 stories: RenameCheckpoint, RenamedCheckpoint, RemoveCheckpointName, OlderNamesWhileUnsaved. **Review:** All four states visually inspected in five variants; fresh `c904` rename/remove/renamed final states verified.
- **Redesign/Entry states**: [source](../../src/ui/redesign/EntryStates.stories.tsx); 13 stories: InvitePending, InviteCancelled, InviteError, InviteInvalid, RecoveryPending, RecoveryCancelled, RecoveryError, RecoveryInvalid, SetupPending, SetupCancelled, SetupError, SetupInvalid, InviteCancelAndRetry. **Review:** All 13 states visually inspected in five variants; operating-system passkey prompts are simulated.
- **Redesign/Guest entry**: [source](../../src/ui/redesign/GuestEntryReview.stories.tsx); 2 stories: AuthLoading, UnsupportedBrowser. **Review:** Both states visually inspected in five variants; fresh plain-language unsupported-browser copy verified at `22d60`.
- **Redesign/Theme control**: [source](../../src/ui/redesign/ThemeMenu.stories.tsx); 3 stories: Default, StorageBlocked, DismissStorageWarning. **Review:** Default/storage-blocked variants visually inspected; warning-dismissal repair awaits full-run interaction validation.
- **Redesign/File recovery**: [source](../../src/ui/redesign/FilesRecovery.stories.tsx); 32 stories: SharedLoading, SharedError, SharedUnknownOwner, SearchPending, SearchError, LocalMode, LocalNoData, LocalNavigation, LocalFolderNotOpened, TrashLoading, TrashError, TrashExpired, EmptyTrashConfirmation, EmptyTrashPending, EmptyTrashFailed, RestorePending, RestoreFailed, DeletePending, DeleteFailed, RetrySearch, RetryShared, RetryTrash, RetryRestore, RetryDelete, RetryEmptyTrash, CancelEmptyTrash, ExpiredRestoreUnavailable, FolderTrashOwnedContents, RestoreFolderDeletionBatch, RestoreChildWithoutParent, FolderTrashKeepsSharedFile, DeleteFolderContentsPermanently. **Review:** Original 27 states inspected in five variants; five new folder scenarios verified in fresh `22d60` renders, and offline navigation at `c904`.
- **Redesign/File mutations**: [source](../../src/ui/redesign/FileMutation.stories.tsx); 15 stories: CreatePending, CreateFailed, RenamePending, RenameFailed, MovePending, MoveFailed, FileIntoFolderPending, FileIntoFolderFailed, RetryCreate, RetryRename, RetryMove, RetryFileIntoFolder, CancelFailedRename, FailedMoveKeepsOriginalFolder, FailedFilingKeepsOriginalPlacement. **Review:** All 15 states visually inspected in five variants; retained drafts/placements represented, full interaction CI passed on reviewed source.
- **Redesign/Profile icon picker**: [source](../../src/ui/redesign/IconPickerReview.stories.tsx); 11 stories: Browse, Search, NoResults, Category, ShowMore, ShowMoreCancelAndReturn, KeyboardNavigation, SelectedIcon, KeyboardSelectAndReturn, CancelAndReturn, NativeCancelAndReturn. **Review:** Original ten states inspected in five variants; fresh ShowMore/ShowMoreCancelAndReturn renders verify visible Cancel and focus return.

## Redesign/Loading

**New proposal, source and rendered variants reviewed.** Shared SVG runner
silhouette follows light/dark themes, uses the same cycle/proportions, preserves
visible context labels and supports a still reduced-motion pose. Page and compact
variants replace existing loading placeholders in files, settings, administration,
consent, history, guest entry and native editor startup. No production-wide loading
migration is claimed.

Source: [LoadingReview.stories.tsx](../../src/ui/redesign/LoadingReview.stories.tsx).
States: Page, Compact, ReducedMotion, BothThemes, LoadingContext.

## Section review gates

- **Files/retrieval:** component and composed visual review completed for the recorded variants; unified toolbar and fresh folder recovery inspected. The five final Tags-dialog variants are now inspected; full interaction CI passed on reviewed source. Search tokens/help builder remain SPN-048.
- **Entry/authentication:** setup/invite/recovery/guest outcomes visually inspected; fresh shared theme controls and plain-language browser recovery verified. Authentication/passkeys are local preview events, not production auth validation.
- **Editor/sharing/history:** component and composed visual review completed; fresh native readiness/scroll and history rename/remove final states verified. Fixed-width mobile Docs and persistent title/action chrome remain limitations. Formula insertion/export/presence jumps are simulated.
- **Settings/connections:** visual review completed for profile, connection, token and device states; fresh actual picker repair verified. Passkey rename/remove remain planned in SPN-070. Server disconnect/persistence is not exercised.
- **Administration:** state and composition visual review completed; permission boundaries and mutation recovery represented. The protected-key badge repair has ten passing, visually inspected `00cc641` captures; full interaction CI passed on reviewed source.
- **Guests/Spaces:** guest guards/revoked/offline/native context visually inspected. Spaces, guest-link inventory and their management actions remain illustrative future-feature scope; fresh planned Restore wording makes the unchanged row explicit. Deep trees retain horizontal overflow/truncated labels.

## Historical evidence and repair provenance

This section records earlier iterations. Pending/failing statuses here are historical; the current status and final evidence are at the top and end of this document.


- Source audits: independent reviewer compared all 35 existing families; UI reviewer audited editor/shared controls; UX reviewer audited six product sections and all four personas.
- App CI for f9cdff3 passed all six required gates. Storybook run 39549253667 produced 1,935 captures and 104 explicit verifications but failed nine responsive Sheet toolbar checks. The compact mobile toolbar exists; its selector has been corrected in the working tree. This failed run does not validate the new component repairs.
- Deployed Doc was manually scrolled at855px and 390×600: native toolbar stays visible; title/save header remains. Native mobile Doc still needs horizontal pan/zoom.
- Existing checked-in gallery is historical until refreshed. No owner approval, whole-product score or merge readiness is claimed.

## Independent source findings during repair

- **P2, fixed:** pending pin updates/retries could overwrite a rename or reintroduce a trashed item. Timer commits now reconcile against the latest catalog; three regression stories cover rename, trash and failed-update retry.
- **P2, fixed:** the phone navigation dialog omitted offline state, enabling pin mutations. Sidebar receives offline state; FilesRecovery checks disabled pin actions in phone/desktop navigation.
- **Specimen gap, filled:** Operator with multiple passkeys can remove one while retaining a protected credential. Added a fixture and interaction story.
- **Visual repair awaiting evidence:** Search/Filters/view controls now share one responsive toolbar, with Type inside Filters, following the section review. Query tokens and a search-help builder remain SPN-048. Fresh screenshots and owner review remain required.

The independent reviewer found no further source blockers in the inspected component repairs. This is not a whole-product grade: all new story plays, keyboard restoration, touch geometry and screenshots require CI/rendered review.

## Live visual pass after the component repairs

- Version names (`dff41bc` deployed): renamed an older checkpoint through its menu; list updated and focus returned to that checkpoint's action menu. This is one manually verified interaction, not all-state acceptance.
- Short-phone dark History showed the page title squeezed beside two actions. The `5655c2c` repair gives the title its own row and lets actions wrap beneath it; subsequent source repair removes the extra inherited action margin. Fresh phone rendering remains pending.
- File retrieval toolbar repair is in `5655c2c`: Search, Filters and view switch share one responsive toolbar; Type moves inside Filters. Active constraints remain visible and clearable. No query parser was added.
- Retained identity pass inspected the four identity families in five variants (`f9cdff3`): 18 source states / 90 identity captures. The earlier 20-state tally included picker material and is not used as identity coverage: EntityIcon, Favicon and GemLogo retained; social artwork retained with a minor trailing-emoji cosmetic note. Actual IconPicker footer gap was repaired only in redesign context; ten new context stories cover search/category/pagination/keyboard/selection/focus return and await CI.

The retained-surface reviewer also inspected all 43 assigned f9c states in light, dark and phone: 19 AccessToken variants, eight Import variants, five Profile states, eight Backup health states and three Controls states. No clipping was found. Two pending-dialog inconsistencies were repaired in the next source batch: Token creation had an enabled-but-inert close button, and Import allowed dismissal despite its keep-open instruction. A shared dismiss-disabled state now covers pending dialogs consistently, with explicit assertions; new rendered evidence remains required. The new Move example supersedes the old Controls dialog.

## Component visual findings from the partial light capture

Reviewers inspected all 219 assigned light states from the canceled `1048e8b` capture: 97 editor/history/sharing/formula/presence states and 122 file/tag/pin/administration/connection states. Contact-sheet screening was followed by original-size inspection of dense, long-name and failure states. This is partial light evidence; it has no completed manifest and cannot establish interaction success or dark/phone acceptance.

Repairs implemented after the partial review; fresh rendering remains required:

- Pins dashboard specimen inherited the production shell, displacing navigation and restyling controls. Opt out of that shell.
- Compact pin status used10px text and split words; replace it with readable compact status.
- Passkey recovery consequences appeared after destructive controls; move guidance before the decision.
- Connection footer spacing, singular file counts and empty Trash artwork need consistency repairs.
- **Source fixed; rendering pending:** Sharing now uses an intrinsic-width Owner badge, compact action spacing and no empty feedback spacer.
- **Source fixed; rendering pending:** History removes repeated visible preview labels and duplicate selected-version metadata; the main preview caption announces selection changes. Phone header actions no longer add an inherited top margin.
- **Source fixed; rendering pending:** Version-name errors yield to waiting/reconnect explanations until retry is possible, with retained-draft assertions in UnsavedDraft.

Section guides now match these current proposals: older checkpoint names remain editable
while current changes are unsaved, direct sharing uses staged Apply and retained drafts,
the people/count dialog remains available on phones, and theme segments use 24 px
visual circles in a 30 px pill with 44 px touch targets. This documentation alignment
does not establish rendered acceptance or owner approval.

The new Files toolbar and pending-dialog dismissal changes in `5655c2c` supersede the corresponding partial captures and require fresh evidence. No reviewer supplied an aggregate grade for this incomplete evidence set.

A third reviewer inspected 40 further light states:13 entry outcomes, two guest entry states, two theme states,13 consent states and 10 actual icon-picker states. This found a theme-storage warning colliding with its tooltip and missing consent recovery actions. The warning now uses a dismissible status panel outside the compact control. Consent limit opens Connections in Settings, with a return to the request; Operator consent offers Sign out and the everyday-account journey. Four consent recovery stories and one warning-dismissal story cover these repairs. Source inventory at that repair was 61 families and 646 exported story specimens; the current catalog has 655 specimens.

App CI run 39553769932 passed all required gates for `5655c2c`. Storybook run 39553769714 completed with 3,199 successful captures, six failed native Sheet captures and 107 explicit verifications across 641 states in five variants. It failed the short-phone resize/toolbar checks; subsequent repairs require their own CI run. No score is carried forward from a previous commit.

## Full-catalog visual follow-up

Reviewers inspected 388 editor/history/sharing/formula/presence captures (97 states)
and 488 file/tag/pin/administration/connection captures (122 states) from `5655c2c`,
covering dark, phone, phone-dark and tablet in addition to the earlier light pass.
Dense, error and long-text states were also inspected at original size.

- **P2, source fixed:** Trash recovery deadlines and expired status were hidden by
  the ordinary file-date rule on phone/tablet. Recovery now has its own visible
  second row, while routine timestamps retain the compact layout.
- **P3, source fixed:** Disabled-account sharing guidance was squeezed beside its
  action on phones. The action now stacks below the guidance.
- **P2, source fixed; CI pending:** The OSS Univer mobile viewport retains a stale
  inline height after a same-width shrink of 80px or more. The preview bounds that
  viewport to its host; CI asserts containment before pointer interaction and
  retains the toolbar-position check after scrolling. No SDK code is patched.
- **Validation gap, source fixed:** Checking only Storybook's finished status
  can miss swallowed play exceptions. Capture validation now also rejects
  recorded play exceptions and unhandled errors. Earlier capture counts do not
  establish that every interaction assertion succeeded.

Manual deployed checks also exercised dark phone formula-result pagination,
long participant names and native Escape dismissal/focus return in the actual
icon picker. These supplement rather than replace the complete capture run.

Current app CI passed all six gates at `bc7249d`. New source repairs and all
previously unverified rendered changes still require fresh evidence. Focused
manual screenshot runs are available for repair verification; PR runs always
capture the full catalog. Whole-product acceptance remains withheld.

## Section and journey repair pass

The supplementary entry/account pass inspected 160 captures across 40 states in
dark, phone, phone-dark and tablet. The section pass inspected 275 captures across
55 Files, Space, Settings, Administration and entry/walkthrough states in all
five variants. These inspections found the following additional repairs:

- The icon picker now scrolls its results independently so Cancel stays reachable
  after Show more. Search, category and actions retain their shared layout.
- Unsupported-browser recovery uses plain language, and all direct entry screens
  retain the shared device theme control.
- This device loses its redundant leading divider; Space trash has one title and
  explicitly describes its restore action as planned instead of claiming success.
- The Doc walkthrough now opens the same catalog record as My files. Returning
  and reopening preserves its type, and editor location labels reflect the actual
  parent rather than always saying Household.
- Folder Trash follows owned subtrees and deletion batches. Shared documents
  survive personal-folder deletion; their filing is cleared. Restoring a folder
  does not resurrect separately deleted children or silently restore pins.

Independent source review found these cross-screen identity and recovery gaps;
component screenshots alone did not reveal them. New interaction specimens cover
Doc return/reopen and folder trash, restore, shared references and permanent
removal. Production APIs remain unchanged; these are coherent local proposals.

Focused CI run 39557852478 at `6a64b0d` passed 50 captures and 32 explicit checks,
including native Doc/Sheet short-phone toolbar behavior, expired recovery,
disabled-account sharing, theme-warning dismissal and unsaved version drafts.
All six application gates also passed for that commit. Inspection showed that
restoring the viewport to 900px could capture the SDK canvas before its deferred
resize; capture now waits for its original CSS and backing-store dimensions.
This stronger guard and the new section repairs require fresh CI. Earlier
full-height images affected by that intermediate resize are not final evidence.

Fresh focused run39559009724 at `22d60b8` passed98 of100 captures. All new
folder, picker, entry, Space and Doc-return interactions passed in five variants;
reviewers inspected35 folder/Space/settings and45 entry/picker/Doc images with no
new visual findings. The two failures concern native Sheet full-editor height:
the initial canvas still had the height from before the review banner closed.
The SDK mobile viewport must follow host growth as well as shrinkage. The next
repair constrains both min/max height and requires workbench-to-host agreement,
skeleton dismissal and canvas-to-container agreement before capturing.

A further visual sweep inspected320 editor/guest/recovery composition images
and260 shared-dialog/control/import/token/profile/backup images. It found
ambiguous retry wording (now Reconnect), two native captures still showing an
SDK skeleton, and21 older file-dialog captures stopped at their prerequisite
menus. The latter are evidence gaps, not accepted final states: menu queries
now await the portal, and Create Doc asserts that its final dialog opened.
The complete run must reject swallowed play errors and recapture these states.

## Stricter interaction validation and repaired captures

Full run 39557835351 at `6a64b0d` recorded 3,230 capture attempts across
646 stories and five variants. It rejected 39 captures across 17 stories because
Storybook plays queried menu items before their Base UI portals mounted. These
had previously appeared successful when only the finished status was checked.
The story repairs await visible menu items and retain their behavior assertions;
the capture runner rejects both swallowed play exceptions and unhandled errors.

Focused run 39560131936 at `dd286c8` passed 85 captures and 34 explicit checks.
It verifies native editor growth/shrink, canvas readiness and scroll containment,
plus repaired file dialogs and offline reconnection. Reviewers inspected all
fresh native/editor and file-dialog states. Focused run 39560538391 at `c904b47`
passed 65 captures with the stricter play-error guard; fresh history, tags, pins,
Operator and offline-navigation images show the intended final states.

The later protected-passkey badge repair at `00cc641` changes only direct badge
children of settings rows. Focused run 39561831008 passed both affected stories
in all five variants (10 captures); visual reinspection confirms the badge fits
its border and phone padding. No other badge layouts use this selector.

## Scoped UI and UX assessments

These assessments apply to the reviewed proposal, not deployed production or an
independent merge gate. Neither is an average across untouched baseline stories.
The reviewers contributed some implementation work; the independent reviewer is
separate. Scores do not replace finding dispositions or owner approval.

- **UI: 94/100.** Deducted three points for the expanded phone filter panel's
  four rows, two for planned Space action feedback distant from its trigger,
  and one for low scan density in one-column phone grid cards. These remain
  explicit design tradeoffs for owner review, not hidden failed actions.
- **UX: 92/100.** Deducted three points for native Doc horizontal pan/zoom on
  phones, three for persistent editor chrome occupying substantial short-phone
  height, one for opening Tags to read truncated labels on touch, and one for
  expanded phone filter density. The title does not automatically hide on scroll.
  SPN-049/072 retain the mobile editor work; SPN-048 owns unified query controls.

Owner and Collaborator friction is concentrated in mobile editing and retrieval.
Link guests retain restricted navigation and explicit loss-of-access states.
Operator setup/recovery/access management remains separate from document access.
The fixtures demonstrate these proposals; they do not validate production
passkeys, authorization, server persistence, exports or live revocation.

## Owner-directed subtraction and loading follow-up

[Decision #128](https://github.com/mxbaylee/spinel/issues/128) removes personal
pinning in this branch, including production controls, API routes, providers and
new schema creation. Legacy SQL tables and cached fields are safely unused;
files, grants, personal folder placement, offline downloads and named-version
retention remain. Independent source review checked these boundaries and the
regression coverage. Earlier pin screenshots and scores are historical.

The same subtraction pass removes Space-header Back, the disabled future passkey
menu and a duplicate empty-results reset. Compact site My files remains icon-only
with an accessible name and tooltip. Query-only no-results retains a reset.
New loading silhouettes share one component and motion contract. These changes now have passing full CI and fresh renders; the earlier scoped grades are not a whole-product acceptance grade.

## Final subtraction evidence

The `a521eca` focused artifact supplied **90 valid captures** across 18 states in
light, dark, phone, dark phone and tablet. All were visually inspected, with nine
dense or important states also inspected at original size. Coverage includes all
five loading specimens and three loading compositions, native Sheet/Doc, Space,
collapsed Files, offline navigation, passkeys, Tags and successful create/invite
retries. No new blocking overlap or clipping was found. The five failed structured
filter specimens from that run were excluded. Their obsolete capture selector
was repaired in `6a627c2`; focused run **39566541453 passed all ten captures**
and explicit reset checks for structured and query-only empty results.

The visual reviewer identified a duplicate privacy explanation in Tags. The
`dc9170f` repair keeps the detailed component explanation and removes the outer
repeat. A separate subtraction review also removed the sole WORKSPACE heading,
generic Browse files description and empty navigation footer. My files, Shared
with me, profile, theme and connection status remain because they serve distinct
persona tasks. Focused run **39567463871 passed all 25 captures and seven explicit checks** for these final changes. Full-catalog run **39567403971** also passed on this source.

Live browser inspection confirmed both loading variants animate using the same
cycle, and confirmed Space navigation opens and selects a child without a
redundant page-title Back button. Static reduced-motion captures and the story's
no-animation assertion cover the still state. The proposal retains contextual
loading text and a single accessible status announcement.

Final `dc9170f` focused renders were visually checked by both the UI and UX
reviewers: all **25 captures**, with original-size checks of dense phone dialogs
and expanded desktop navigation. Both found no new visual issue. Tags now shows
one privacy explanation, the Files drawer is shorter, and the destinations and
close control remain. The old Tags final-state evidence gap is closed.

The latest **scoped UI score remains 94/100** (phone filter density −3, distant
planned-Space action feedback −2, spacious phone grid −1). **Scoped UX remains
92/100** (native phone Doc panning −3, fixed short-viewport editor chrome −3,
truncated-tag discovery on touch −1, expanded filter height −1). The UI reviewer
also assessed reviewed proposal maintainability at **94/100**, deducting for the
large multi-screen Mockups source (−4) and layered responsive CSS (−2). These
reviewers authored earlier repairs, so these scores are neither independent merge
approval nor a whole-product average. The independent rubric is recorded
separately with exact source and CI evidence.

Independent source review of `dc9170f` found no blocking scope, correctness or
access issue. It retained a one-point maintainability deduction for superseded
shell CSS declarations and accepted [SPN-087](../todo/SPN-087.md) as the separate
cleanup disposition. The reviewer explicitly did not penalize file size alone
or request a new framework. Final independent grading follows the complete current-source artifact; the source subtotal alone is not an aggregate grade or merge approval.

## Final independent rubric

Read-only reviewer `/root/removal_independent` assessed application source
`dc9170fa68243fa10ad34d700e0e8f9cf4471c40` against main
`6c09bd46f88ce30dbfa309548c9d901b1c5f220b`: **99/100, no unresolved source blockers**.
Scope 35/35, correctness/data/access 25/25, verification 20/20, CI 10/10,
maintainability/complexity 9/10. The single P3 deduction is superseded shell CSS,
tracked by SPN-087; filing the ticket does not erase the deduction.

The reviewer checked the original ticket, full branch changes, all personas,
assertion relevance and failure propagation, successful application/full-catalog
workflows on that exact source, selected rendered states, and SHA-256 matches
for all **203 current gallery images** against the named CI artifacts. The 66
older baselines retain their provenance. The full report is recorded in PR #125.

This engineering/specification assessment is separate from UI 94, UX 92 and the
scoped proposal-maintainability 94. No scores are averaged. The final packaging
commit changes documentation, images and the follow-up backlog only. Owner design
approval, its applicable head checks and removal of the temporary Pages exception
remain prerequisites before merge. No merge is authorized by this review.

## Authorized merge preparation

Owner approved the designs and authorized merge on 2026-10-21. The PR-specific
Pages job/upload exception and environment rule 63792144 were removed; main
publishing remains review-gated. The owner clarified that native dark rendering,
folder-color mockups, Space Trash and modal icons must be finished in this PR.
These refinements supersede the earlier proposal-only handoff interpretation.

The owner waived refreshing screenshots and requested deleting their embeds from
the PR description. Historical gallery provenance stays intact. Earlier scores
and images do not certify the new refinements; the final source needs current-head
checks and independent review. SPN-086/078/089 retain production integration work;
SPN-088 was subsequently [retired on 2026-10-23](../implementation/SPN-088.md#retain-native-colors-and-retire-the-extra-palette-proposal), retaining native colors instead of adding the eight-choice enhancement.
