# SPN-047 design review

Status: proposed in [PR #125](https://github.com/mxbaylee/spinel/pull/125), awaiting
owner visual approval in [decision #126](https://github.com/mxbaylee/spinel/issues/126).
The owner authorized this redesign on 2026-10-20. These are review mockups;
production screen migrations land in their individual tickets after approval.

## Direction

Keep the gem rail, Vintage/Modern palettes and Doc/Sheet/Space facets. Reduce
competing controls and separate navigation from the document being edited.
Use one primary action per view, clear labels, quiet surfaces and purposeful
spacing. The content, rather than surrounding cards, carries the personality.
The document sample's serif typography is authored content, not a new UI font.

The Owner needs quick file retrieval and confidence that work is safe. The
Collaborator needs the same layout with truthful access and save states. The
Operator needs manageable account/health sections without document access. A
Link guest needs one document or Space with no account identity or workspace
navigation. Phone layouts are part of each journey, not a separate persona.

## Evidence and comparisons

Reviewed public documentation and its illustrated examples on 2026-10-20. No
competitor was signed into; no assets or implementation were copied. These are
pattern observations, not claims about every plan, device or current screen.

- [Google Docs/Sheets view controls](https://support.google.com/docs/answer/99753):
  document space can take priority over chrome. Keep Spinel's existing Univer
  toolbar; remove surrounding file-search and utility panels from editor views.
- [Google sharing](https://support.google.com/docs/answer/2494822): people and
  general access are distinct decisions. Adopt their grouping, while preserving
  Spinel's stricter owner-only sharing and once-only guest-link reveal.
- [Excel for the web](https://support.microsoft.com/en-us/excel/basic-tasks-in-excel-for-the-web):
  file identity belongs in the top ribbon/header. Spinel needs one compact title
  region and predictable file actions, not another ribbon implementation.
- [Numbers for iCloud](https://support.apple.com/guide/numbers-icloud/welcome/icloud):
  the illustrated Format inspector separates contextual detail from the sheet;
  sheet tabs organize related content. Adopt contextual disclosure and stable
  navigation, without copying Numbers' freeform-canvas model.
- [Notion sidebar](https://www.notion.com/help/navigate-with-the-sidebar): navigation
  and favorites form one hierarchy. Adopt a small fixed structure; reject its
  extensive workspace customization and hover-only action discovery for this
  two-person, touch-capable product.
- [Notion preferences](https://www.notion.com/en-gb/help/account-settings): appearance
  has explicit light/dark/system choices. Propose those choices in a compact
  rail menu plus the full profile setting; one shared preference, not two states.
- [Dropbox navigation](https://help.dropbox.com/installs/homepage): file search,
  shared files, folders and creation have distinct places. Consolidate Spinel's
  pins/folders/shared navigation; keep one New action and one menu per file.
- [Dropbox quick access](https://help.dropbox.com/organize/quick-access): personal
  shortcuts do not change shared organization. Preserve Spinel's personal pins
  and filed shared references without implying shared ownership.

The comparisons on each screen page translate these observations into a
specific layout. Competitor patterns inform placement; Spinel's access,
recovery and offline contracts remain authoritative.

## Composed layout contract

- Global rail: 64 px, brand/home at top, appearance and profile at bottom.
  On phones it becomes a 64 px top bar. Theme opens three named choices;
  this replaces the provisional cycling proposal only after owner approval.
- File sidebar: one 208 px column, 176 px at tablet width, containing places,
  pins and folders. On phones a labelled Browse files button opens a modal
  drawer. It does not stack a long navigation list above the files.
- File views: 28 px title, one New action, search and file-type selector, then
  rows. Extra search filters belong in a disclosure; active filters remain
  visible and clearable. File rows show name, type, access, limited tags and
  edited date. Dates move out at narrow widths before names lose space.
- Editors: no file-search panel, dashboard title or pinned sidebar. One 80 px
  header holds identity, a fixed status slot and permission-appropriate actions.
  The actual Univer toolbar remains the only editing toolbar. Mockups draw a
  schematic toolbar; they do not replace or promise new Univer commands.
- Profile and Operator pages: section navigation replaces a long stack of
  equally weighted cards. Phone section navigation scrolls horizontally, with
  labels retained. Operator and file Admin are different concepts.
- Dialogs: one title and description, explicit close control, one task, actions
  together. Menus contain actions; selectors contain choices. Hidden detail
  never hides an access warning, failed save or required recovery action.
- Phone: 640 px breakpoint; tablet: 900 px. Controls are at least 44 px on
  touch. Only sheet/document content may pan; the page itself must fit.

CSS remains scoped to the prototype/shared controls. No global palette or
production typography is changed by this PR. Type scale is 28/18/14/12 px for
page heading/section/body/secondary, with compact 10–11 px metadata used sparingly.
The existing 4/8/12/16/24/32 spacing scale remains; 40/48/64 are explicit large
layout/content gutters, not arbitrary per-control spacing. These choices are
reviewable in the screenshots before consumer migration.

## Base UI foundation

`@base-ui/react` 1.9.0 (MIT) is pinned. It supports the existing React 18 setup.
Only Button, Menu, Select, Dialog and Popover are used. There is no second
primitive library, no Tailwind, and no production consumer migration here.

The shared components in `src/ui/redesign/Controls.tsx` apply Spinel tokens and
names; Base UI supplies focus and keyboard behavior. Portals inherit theme
variables from the document root. Dialog/select stacking is exercised together.
[Base UI's accessibility guidance](https://base-ui.com/react/overview/accessibility)
and [composition examples](https://base-ui.com/react/components/dialog) inform
these uses; accessibility still needs consumer verification.

The screenshot runner checks named roles, menu arrow keys, Escape and focus
return, selector selection, nested portal visibility/theme, and dialog focus
containment. It emits accessibility-tree snapshots. This verifies programmatic
screen-reader semantics; it is not a claim of manual VoiceOver/NVDA testing.
SPN-060 adds general axe and visual-regression enforcement.

Bundle impact is recorded from emitted Storybook chunks in `bundle-size.json`.
Production has no imports of this directory, so Base UI is not introduced into
the shipped app bundle until a screen ticket adopts it. No dependency source
was copied; the installed MIT license remains with the package.

## Review and screenshots

Build Storybook, then run `npm run screenshots -- <story ids>`. With no IDs it
captures all Redesign stories and the listed current-screen stories. Unknown
IDs fail. The runner uses one Chromium page at a time, fixed fixture time,
reduced motion, light/dark desktop, light/dark phone and light tablet. It checks
runtime failures and horizontal page overflow for proposed screens.

Output: `test-results/design-review/index.html`, PNGs, `manifest.json`, control
semantics and bundle sizes. Storybook CI uploads this as **design-review**.
Open the downloaded index to browse each screen across sizes. The PR links
this artifact and embeds representative before/after images. These are review
captures, not approved regression baselines.

Current editors are captured by `e2e/appearance.spec.ts`, phone editor/formula
fixtures and the production CI artifacts. Current sign-in/setup/guest states
are captured by the design-inventory Playwright fixture. Current screens and
proposals are labelled separately; planned Spaces and file Admin have no
production “before”. The inventory below maps every surface to its evidence.

Local builds/browser/tests are deferred whenever macOS memory pressure is not
normal, under decision #52. CI is authoritative for this draft's browser evidence.
Do not run another agent's local workload concurrently.

## Screen and journey inventory

| Surface / journey | Current evidence | Proposed story suffix under `Redesign/Screens` | Implementation |
| --- | --- | --- | --- |
| Find files, folders, pins | Shell/AppLayout; Dashboard/Dashboard | Dashboard, EmptyFolder, LoadingFiles, FileError | SPN-048 |
| Search and narrow results | Dashboard/SearchPanel | Search | SPN-048, SPN-069 |
| Shared references | Dashboard/Dashboard SharedDrawer | SharedFiles | SPN-048 |
| Trash and restore | Dashboard/Trash | Trash | SPN-048, SPN-064 |
| Doc and Sheet work | production appearance screenshots | Doc, Sheet, ViewOnly | SPN-049 |
| Save and connectivity | Editor/OfflineStatus; production offline fixtures | OfflineEditor | SPN-042, SPN-043, SPN-053 |
| Formula creation/results | Editor/DocFormulas; native formula screenshots | Formula, FormulaInContext | SPN-049, SPN-076 |
| History preview/restore | Editor/VersionNames; history-calendar screenshot | History | SPN-085 |
| Sharing and guest links | Sharing/Sharing; Sharing/ShareLink | Sharing | SPN-081 |
| Profile and appearance | Settings/ThemeSettings; profile PR #124 | Profile | SPN-045, SPN-036 |
| Passkeys | current settings Playwright capture | Profile (Passkeys section) | SPN-045, SPN-070 |
| Connections / tokens | Settings/AssistantConnections; Settings/AccessTokens | Connections | SPN-045 |
| Consent and expiry | Settings/ConnectAssistant | Consent, ConsentExpired | SPN-083 |
| Offline files on device | existing offline fixtures; planned storage management | ThisDevice | SPN-052 |
| Administration | Admin/AdminUsers, AdminInvites, BackupStatus, AccessTokens | Admin, AdminLoading, AdminError | SPN-082, SPN-032 |
| Sign-in/setup/invite/recovery | actual App routes in design-inventory fixture | SignIn, Setup, Invite, Recovery | SPN-083 |
| Guest view/edit | Guest/GuestApp; guest-link browser fixtures | GuestViewer, GuestEditor | SPN-084, SPN-075 |
| Revoked link / unavailable | Guest/GuestApp LinkRevoked | RevokedLink, MissingFile | SPN-084 |
| Offline launch | Guest/GuestApp ConnectionInterrupted | OfflineLaunch | SPN-042 |
| Space navigation and internal trash | planned; SPN-077 facets | PlannedSpace, PlannedSpaceGuest | SPN-078 |
| Delegated file roles | planned | PlannedFileAdmin | SPN-079 |
| Shared controls | current native controls in each screen | Redesign/Controls Default, Disabled, Error | shared now; consumers later |

## Owner review

The first useful feedback is whether the dashboard/editor hierarchy feels calm,
whether the retained color identity is right, and whether the explicit theme
menu is preferable to cycling. The final approval covers every composed screen
and light/dark/phone screenshots. Approval must be recorded in the PR before
merge, as required by `docs/todo/process.md`; a passing build is not design approval.
