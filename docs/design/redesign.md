# SPN-047 design review

Status: owner approved as-is and merge authorized on 2026-10-21 in chat,
recorded in [decision #126](https://github.com/mxbaylee/spinel/issues/126) and [PR #125](https://github.com/mxbaylee/spinel/pull/125).
The owner authorized this redesign on 2026-10-20. These are review mockups;
production screen migrations land in their individual tickets after approval.

## Direction

Keep the gem identity, Vintage/Modern palettes and Doc/Sheet/Space facets. Reduce
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

Reviewed public documentation and its illustrated examples on 2026-10-20, then
inspected the owner-authorized signed-in navigation and search surfaces in
Google Drive, Proton Drive and Coda/Superhuman Docs. No private document content,
assets or implementation were copied. These are
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
  direct three-segment control plus the This device setting. The preference is
  browser-local, defaults to System and is separate from saved profile identity.
- [Dropbox navigation](https://help.dropbox.com/installs/homepage): file search,
  shared files, folders and creation have distinct places. Consolidate Spinel's
  folder/shared navigation; keep one New action and one menu per file.
- [Dropbox quick access](https://help.dropbox.com/organize/quick-access): personal
  shortcuts do not change shared organization. Preserve filed shared references
  without implying shared ownership. Personal pinning was rejected by the owner
  on 2026-10-21 ([decision #128](https://github.com/mxbaylee/spinel/issues/128)); competitor favorites are not a requirement.

The comparisons on each screen page translate these observations into a
specific layout. Competitor patterns inform placement; Spinel's access,
recovery and offline contracts remain authoritative.

## Composed layout contract

- File navigation: one 224 px column with gem, places and account
  utilities. Collapse reduces it to a 64 px rail; an icon-only chevron or local Pages control
  reopens it. Never show the rail beside an expanded tree. At tablet/phone
  widths (900 px and below), navigation is a drawer by default.
- Ordinary editors and Operator screens use a compact horizontal utility header,
  avoiding a permanent second navigation column. Spaces keep the optional
  internal Pages tree. Guests retain no account utilities.
- File views: 28 px title, one New action, search and file-type selector, then
  rows. Extra search filters belong in a disclosure; active filters remain
  visible and clearable. File rows show name, type, access, limited tags and
  edited date. Dates move out at narrow widths before names lose space.
- Editors: no file-search panel, dashboard title or file sidebar. One compact
  header holds identity, a fixed status slot and permission-appropriate actions.
  The actual Univer toolbar remains the only editing toolbar. Connected Sheet/Doc
  walkthroughs embed native open-source Univer with local samples. Standalone
  structural stories retain schematic content for planned states; they do not
  replace or promise new Univer commands.
- Profile and Operator pages: section navigation replaces a long stack of
  equally weighted cards. Profile section navigation wraps into two columns on phones, with
  labels retained; Operator sections wrap so Backups & health stays discoverable. Operator and file Admin are different concepts.
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
Button, Menu, Select, Dialog, Popover and RadioGroup/Radio are used. There is no second
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
The [manual design review runbook](review-runbook.md) covers design changes with
focused human/AI review. General axe enforcement and stored pixel baselines are
not implemented by this work; the former SPN-060 automation proposal was retired
in the 2026-10-21 grooming at the owner's direction.

Bundle impact is recorded from emitted Storybook chunks in `bundle-size.json`.
Production has no imports of this directory, so Base UI is not introduced into
the shipped app bundle until a screen ticket adopts it. No dependency source
was copied; the installed MIT license remains with the package.

## Review and screenshots

The [durable visual gallery](review/README.md) contains before/after light, dark
and phone samples for the main families, including grid/collapsed alternatives.
`review/capture-sources.json` records the CI sources. Owner design approval was given on 2026-10-21.

Build Storybook, then run `npm run screenshots -- <story ids>`. With no IDs it
captures every story in the catalog. Unknown
IDs fail. The runner uses one Chromium page at a time, fixed fixture time,
reduced motion, light/dark desktop, light/dark phone and light tablet. It checks
runtime failures, horizontal page overflow and visible 44 px touch targets for proposed screens. Base UI’s aria-hidden form inputs are excluded from target checks.

Output: `test-results/design-review/index.html`, PNGs, `manifest.json`, control
semantics and bundle sizes. Storybook CI builds once and captures in parallel:
**design-review-desktop** (light/dark), **design-review-tablet** (light) and
**design-review-mobile** (light/dark). Each artifact is a complete gallery for
its selected variants. `--viewport desktop|tablet|mobile` selects the same local
partition; omitting it retains the full review. Native editor interaction proofs
and the icon suite run once on desktop; tablet retains the 613 px mouse checks.
The aggregate review gate requires every partition before Pages deployment.
Open the downloaded index for paired current/proposed stories, followed by every state across sizes. The PR links
this artifact and embeds representative before/after images. These are review
captures, not approved regression baselines.

Current editors are captured by `e2e/appearance.spec.ts`, phone editor/formula
fixtures and the production CI artifacts. Current sign-in/setup/guest states
are captured by `design-inventory`, `setup` and successful viewer/editor paths in
`guest-links` Playwright fixtures. Current screens and
proposals are labelled separately; planned Spaces and file Admin have no
production “before”. The inventory below maps every surface to its evidence.

Local builds/browser/tests are deferred whenever macOS memory pressure is not
normal, under decision #52. CI is authoritative for this draft's browser evidence.
Do not run another agent's local workload concurrently.

## Screen and journey inventory

| Surface / journey                   | Current evidence                                           | Proposed story suffix under `Redesign/Screens`                                     | Implementation              |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------- |
| Find files and folders              | Shell/AppLayout; Dashboard/Dashboard                       | Dashboard, EmptyFolder, LoadingFiles, FileError                                    | SPN-048                     |
| Search and narrow results           | Dashboard/SearchPanel                                      | Search, AdvancedSearch, NoMatches                                                  | SPN-048                     |
| Shared references                   | Dashboard/Dashboard SharedDrawer                           | SharedFiles                                                                        | SPN-048                     |
| Trash and restore                   | Dashboard/Trash                                            | Trash                                                                              | SPN-048, SPN-064            |
| Doc and Sheet work                  | production appearance screenshots                          | Doc, Sheet, ViewOnly                                                               | SPN-049                     |
| Save and connectivity               | Editor/OfflineStatus; production offline fixtures          | OfflineEditor                                                                      | SPN-042, SPN-043, SPN-053   |
| Formula creation/results            | Editor/DocFormulas; native formula screenshots             | Formula, FormulaInContext, FormulaTableInContext                                   | SPN-049, SPN-076            |
| History preview/restore             | Editor/VersionNames; history-calendar screenshot           | History                                                                            | SPN-085                     |
| Sharing and guest links             | Sharing/Sharing; Sharing/ShareLink                         | Sharing, SharingCreatedLink, SharingExistingLink, SharingReplaceLink, SharingError | SPN-081                     |
| Profile and appearance              | Settings/ProfileSettings; landed SPN-036                   | Profile, ProfileIconPicker, ProfileColorPicker                                     | SPN-045                     |
| Passkeys                            | current settings Playwright capture                        | Profile (Passkeys section)                                                         | SPN-045, SPN-070            |
| Connections / tokens                | Settings/AssistantConnections; Settings/AccessTokens       | Connections                                                                        | SPN-045                     |
| Consent and expiry                  | Settings/ConnectAssistant                                  | Consent, ConsentReadOnly, ConsentExpired                                           | SPN-083                     |
| Offline files on device             | existing offline fixtures; planned storage management      | ThisDevice                                                                         | SPN-055                     |
| Administration                      | Admin/AdminUsers, AdminInvites, BackupStatus, AccessTokens | Admin, AdminLoading, AdminError                                                    | SPN-082, SPN-032            |
| Sign-in/setup/invite/recovery       | actual App routes in design-inventory fixture              | SignIn, Setup, Invite, Recovery                                                    | SPN-083                     |
| Guest view/edit                     | Guest/GuestApp; guest-link browser fixtures                | GuestViewer, GuestEditor                                                           | SPN-084, SPN-075            |
| Revoked link / unavailable          | Guest/GuestApp LinkRevoked                                 | RevokedLink, MissingFile                                                           | SPN-084                     |
| Offline launch                      | Guest/GuestApp ConnectionInterrupted                       | OfflineLaunch                                                                      | SPN-042                     |
| Space navigation and internal trash | Space/Review and Space/Guest; account navigation/Trash, scoped guest tree, selected-page offline; SPN-077 facets | PlannedSpace, PlannedSpaceGuest, PlannedSpaceGuestEditor, PlannedSpaceTrash        | SPN-091 account experience; SPN-092 guest/integration activation |
| Guest-link inventory                | planned metadata list                                      | PlannedGuestLinks                                                                  | SPN-066                     |
| Delegated file roles                | planned                                                    | PlannedFileAdmin                                                                   | SPN-079                     |
| Shared controls                     | current native controls in each screen                     | Redesign/Controls Default, Disabled, Error                                         | shared now; consumers later |

## Owner review

Review by subtraction: remove controls and repeated labels that do not earn
their space in the task. A polished redundant component still adds clutter.
Use the [playbook criterion](README.md#review-by-subtraction), including compact
header icon-only navigation and no redundant Space-page Back button.

Use the [connected walkthrough guide](walkthrough.md) to judge each persona’s
full task, including return navigation, recovery and phone layouts. The owner has
selected the directly visible System / Light / Dark segments and retained color identity. The final approval covers every composed screen
and light/dark/phone screenshots. Approval must be recorded in the PR before
merge, as required by `docs/todo/process.md`; a passing build is not design approval.

## Persona walkthrough repairs

Owner feedback (chat, 2026-10-20) found the first permanent rail/sidebar pair
redundant. Separate Owner/Collaborator and Operator/Link-guest reviews checked
jobs rather than isolated component styling. Their resulting changes are part
of the proposal, still subject to screenshot approval:

- Retrieval: one collapsible navigation column; tablet drawer; remove the phone
  Browse strip and repeated workspace eyebrow. Search names its current scope,
  with Search all files available from a folder/shared view. Returning from a
  document must restore folder, filters and scroll position in SPN-048/049.
- Collaboration: an editable collaborator gets Can edit and an access explanation,
  without owner-only Share actions; editable collaborators retain version naming/restore. Trash fixtures contain owned files only.
- Recovery: selection is visibly highlighted, slider and label agree, preview and
  confirmation identify the checkpoint, and Return to document remains available.
- Guests: two-row phone headers keep long names readable; viewer status says
  Connected, PDF has a visible label, and guest page deletion explains that an
  account editor can restore it. No account history/navigation is exposed.
- Operator: all phone sections stay visible; Create invite belongs to Invites;
  created-invite/manual-copy, account passkeys, named disable confirmation, protected
  Operator and overdue backup states are separate review specimens.

Mockup actions demonstrate placement and local feedback; they do not implement
networking, actual passkey operations or document persistence. Production tickets
must preserve the existing security/behavior contracts during migration.

Current owner direction (chat, 2026-10-21): folders are rows in **My files**.
Personal pinning and pinned navigation are removed ([decision #128](https://github.com/mxbaylee/spinel/issues/128)); folders, tags and search
provide retrieval without another shortcut list. The expanded sidebar uses the original saturated `--sp-rail` pink and
matching `--sp-rail-ink` foreground (owner correction, 2026-10-20). Profile and Appearance occupy separate rows. Trash is a permanent
folder entry in My files with no rename/move/delete controls; it is not another
sidebar destination. A network icon beside the gem shows connection state,
with an accessible label and hover/tap explanation. Document save warnings
remain explicit; network state never substitutes for save confirmation.

Owner refinement (chat, 2026-10-20): offer **List and Grid** views over the same
files, filters and actions. Default to List; remember the preference during the
screen migration. Folders and permanent Trash appear in both. Desktop collapse
keeps My files and Shared with me directly accessible, with full accessible
names and hover/focus labels; phone/tablet navigation stays in the drawer.
Space trees reopen from Pages rather than flattening a hierarchy into icons.

Use a deterministic normalized-filename hash to choose a default botanical emoji
for Doc/Sheet/Space identity. The same title has the same cue on every surface;
a rename may change the default, and collisions are expected. It is decorative,
never an identifier or substitute for a type/access label. Folders and Trash keep
their functional icons. Defer the persistent emoji/icon picker to **SPN-086**;
no picker ships in this proposal. Owner/Collaborator gain recognition and view
choice; Guests retain scoped identity and access clarity; Operators gain no
personal file navigation or service dependency. Decision #126.

Owner selection (chat, 2026-10-20): **System / Light / Dark** is a three-segment
icon control (monitor, sun, moon), with a circular selected surface. Use Base UI
RadioGroup/Radio for single selection and arrow-key behavior, accessible names,
visible focus, 24 px visible segments and at least 44 px touch targets. Expanded navigation shows the control
on its own row above Profile. Collapsed desktop navigation stacks its segments vertically; compact/phone headers show it horizontally;
This device reuses it. This supersedes the earlier explicit-menu proposal, retains
one theme store and follows OS changes while System is selected. The picker
must report a storage failure without undoing the in-session theme choice.

## Whole-product review follow-up

Owner feedback (chat, 2026-10-20): the presentation overemphasized signed-in
My files. Individual compositions do not yet demonstrate complete journeys.
The next review must foreground the homepage, sign-in, settings, Admin, initial
Operator setup, Sheet and Doc screens, including transitions and recovery states.
Existing compositions remain proposals, not approval of those flows. The homepage
needs an explicit proposal; sign-in alone does not cover arrival.

Shrink the appearance group to 24 px segments with 15 px glyphs on pointer
desktops; retain 44 px targets on touch. File metadata pairs each Doc/Sheet/Space
label with its existing 16 px entity icon, alongside the separate decorative
filename emoji. Owner and Collaborator gain faster recognition without enlarging
the row; guest identity and Operator access remain unchanged. Decision #126.

### Connected walkthrough

`Redesign/Walkthrough` connects the Owner, Collaborator, Operator and Link guest
jobs with local fixture state. Sign-in outcomes and connection/save events live
in a separate review toolbar, not the product interface. No credentials, accounts
or documents are changed. The homepage is a new arrival proposal; production
currently redirects signed-out arrivals to sign-in. Setup remains reachable only
from a server-issued link, with a separate everyday account invited afterward.

Open files, create Doc/Sheet, return with search/folder/layout context, visit
settings and return to the document, browse history with the current permission,
and sign out through product controls. Operator setup reaches first-run Admin,
then a purpose/expiry invitation form and once-only link. Guest revocation removes
the document surface; a transient disconnect preserves it with an unsent-work
warning. The CI screenshot runner exercises representative journeys sequentially at
desktop and phone widths. Read the captured workflow’s result separately; rendered
screenshots alone do not prove every journey assertion passed.

Owner direction (chat, 2026-10-20, decision #126): appearance is local to the
browser and defaults to System. No account preference overrides it on sign-in.
Members, Operators and guests can change it; the profile form only saves personal
identity. This device labels it explicitly, while compact controls remain in
navigation and guest/arrival headers. Use US English “color” in UI and prose.

Interactive CI builds are uploaded as `storybook-review` for seven days. They
can be served locally without rebuilding Storybook. The owner subsequently
authorized the temporary PR #125 Pages preview described below. Publishing the
review does not authorize a production route migration.

Owner refinement (chat, 2026-10-20): keep the three appearance segments directly
visible everywhere. Smaller sizing did not mean a popup. A collapsed desktop
rail stacks the segments vertically; header, phone and expanded-sidebar placements
keep the horizontal group. This supersedes earlier popup treatments.

## Live reference follow-up

Owner-authorized UI review, 2026-10-20: Drive's advanced-search form keeps
detailed criteria behind one search control; Proton groups icon-led creation
commands in its New menu; Coda's document list puts identity and muted location
metadata ahead of actions. These observations reinforce the single search/query
direction in SPN-048, icon-led New menu and quiet file rows. Only UI patterns
were recorded; PR evidence uses Spinel sample data.

## Interactive review publishing

Owner, chat 2026-10-22: a same-repository PR labeled `storybook-preview` may
replace the shared GitHub Pages catalogue as soon as its Storybook build succeeds.
Main retains its normal review gate and can overwrite that preview on its next
deployment. There is no active-PR ownership lock, automatic restoration, or merge
authorization: **the latest deployment wins**. Rerun the PR Storybook workflow
when its preview is needed again. A manual branch run can also set
`publish_preview=true`, optionally with focused `story_ids` for screenshot review.
GitHub's existing deployment concurrency only serializes overlapping uploads.

`/spinel/sha.json` records source SHA, checked-out SHA (the merge SHA for PR
events), branch, PR number when available, workflow URL and build time. Fetch
with a cache-busting query when verifying a fresh deployment. Every static build
also writes the current app gem to `favicon.svg` and replaces competing favicon
links in manager/iframe HTML with one SHA-versioned URL. This avoids Storybook's
default artwork and cached icon ambiguity.

The `github-pages` environment allows `main`, `refs/pull/*/merge`, and `codex/*`
for these previews. Fork PRs do not receive preview publishing. This is a static
sample-data catalogue; publishing it does not approve a production UI migration.

The owner authorized a temporary sample-data preview for PR #125. Before merge,
its workflow exception and environment rule `refs/pull/125/merge` (63792144) were
removed. Normal main Storybook publishing remains enabled and waits for the
complete visual/interaction review. The catalog retains the approved proposal
alongside explicitly labeled current-production specimens.

## Catalog-wide audit scope

Every story, including existing empty, loading, disabled and failure variants,
is included in the CI capture inventory. The sidebar groups unchanged routes
under **Current production**, preserving their story IDs and tests. **Redesign**
contains the proposed patterns; **Identity** keeps shared artwork. Existing
production specimens remain useful before/after evidence, not alternative
recommendations for new screens.

- AppLayout and Rail converge on one Shell; folders and Trash are content.
  Personal pinning and its UI are removed by owner direction, 2026-10-21. GemLogo, entity icons, social cards and cursor
  profile glyphs retain their existing identity; the favicon is enlarged.
- Dashboard, SearchPanel, DocumentTags, TagLabels, SharedBadge and
  OfflineBadge are reviewed as file-row/search/navigation states. Their proposed
  actions use one row menu, visible access metadata and a shared failure/retry
  pattern. The query-chip/parser change remains explicitly scoped to SPN-048.
- Trash drops New and the editing toolbar. ImportFile has dedicated picker,
  limits, validation, progress and failure specimens under Redesign/Import file.
- Profile, Icon picker and ThemeSettings share the proposed settings shell and
  direct appearance segments. The existing searchable/category-based icon picker
  is retained; this review does not claim to replace its icon corpus or browsing
  algorithm. Loading and failed-save specimens retain the draft and recovery.
- AssistantConnections, personal/Admin AccessTokens and ConnectAssistant use
  Connections, token metadata and consent states. Token examples cover the
  existing once-only secret, capacity, pending and failure contracts; Operator
  specimens never show secrets or personal document access.
- AdminUsers, AdminInvites and BackupStatus use the same account rows and section
  navigation, including protected operator, invite reveal, running, failed,
  missing configuration and unavailable health states.
- VersionNames and FileExports use the editor menu and dedicated version page,
  with naming, restore confirmation, unavailable history and export retry states.
  Restore remains unavailable offline or before unsaved changes are resolved.
- Collaborators and profile cursor labels retain the actual presence behavior;
  proposed editor headers reduce duplicate capability text. Existing many/empty/
  guest cursor specimens stay as implementation evidence.
- Formulas and Native formulas retain the shipped source-selection, expression
  and calculation behavior. Proposed composed examples determine placement and
  quiet result/error presentation; source editing and pagination are still
  verified against the actual native/formula stories, not a second formula engine.
- GuestApp retains link-only scope, immediate revocation and browser-capability
  guards. Connected guest walkthroughs cover view/edit, disconnect and revocation;
  existing guest loading/unsupported-browser stories remain contract evidence.
- FillPresets is intentionally removed from proposed editor actions. Native
  Univer owns cell fill; retaining a production-baseline story does not promise
  a replacement control or SDK override.

This audit distinguishes reusable patterns from backend integrations. Screen
migration tickets must retain their existing contract tests and apply the approved
state patterns, rather than shipping a successful-state mockup alone.

## Change boundary reassessment

The whole-product proposal exceeds the process's approximate 10k-line split
prompt. The boundary was reassessed: shared controls, composed examples, persona
journeys, the design playbook and their review evidence form one proposal for
owner approval. Production screen migrations remain in the existing screen
tickets; no backend, storage or authorization redesign is included here. The
favicon and owner-requested pinning removal are explicit production exceptions. Token/import/recovery
examples fill the catalog audit gaps rather than shipping those workflows.
The temporary PR Pages exception was removed during merge preparation.

Owner refinement, chat 2026-10-20: the dark browser favicon rotates the heart
180 degrees to match the dark UI logo; the light favicon remains upright.
The automatic SVG follows the browser color scheme. Both retain tight framing.

Owner refinements, chat 2026-10-20: document actions use **Share** with a matching
icon; Versions, Export and Insert formula use the same icon alignment. Preview
controls can be dismissed for an unobstructed editor. Native editors fill the
remaining viewport so their toolbars stay visible while content scrolls inside.
Phone layouts retain a compact file identity and save state. Every tap on an
interactive logo restarts its wiggle; reduced-motion preferences disable it.

Space tree disclosure controls and leaf placeholders share a gutter, including
44 px touch targets, so each child icon is indented from its parent. Deep trees
scroll within their navigation region and keep full accessible names. The
recursive proposal has no arbitrary depth cap; an eight-level story checks the
layout. Coda also documents unlimited nesting in its
[page organization guidance](https://help.coda.io/hc/en-us/articles/39555791682061-Organize-pages-and-subpages).
These refinements favor Owner/Collaborator navigation and mobile editing, retain
Guest document-only scope, and add no Operator service or data-access burden.

## Approval and final implementation handoffs

The owner approved the designs and authorized merge on 2026-10-21, then clarified
that the final requested refinements should be included: usable native dark
rendering, an interactive folder-color mockup, Space Trash as a deleted-item
collection, and consistent modal title icons. The owner explicitly waived a
refreshed screenshot gallery and requested removal of screenshots from the PR
description; the merged interactive catalog will publish through normal main CI.
Historical captures retain their original provenance and do not certify these
final refinements. Current-head checks and independent review remain required.

- SPN-086 carries document icons and folder-color persistence into production.
- SPN-078 carries Space Trash metadata into the durable model, SPN-091 builds the collection/recovery UI, and SPN-092 verifies guest/integration boundaries before exposing Spaces.
- SPN-089 applies the shared proposal modal title-icon pattern to production.
- SPN-088 investigates eight semantic color choices through public APIs; retain
  native pickers if replacement is unsupported. Preserve stored formatting,
  legacy presets and exports.

Production screen migrations remain separate. The Operator gains no document
access; other personas keep existing permissions, recovery and device-local
theme semantics. The updated proposal lets the Owner inspect folder identity
and recovery while keeping Collaborator and Guest actions within their roles.
