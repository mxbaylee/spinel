# Spinel design playbook

## SPN-047 review status

The [composed redesign](redesign.md) is proposed in PR #125 and awaits owner
approval in decision #126. Its screen inventory, public-source comparisons,
Base UI controls and before/after screenshot gallery define the next UI work.
Start with the [connected walkthrough guide](walkthrough.md) to review full journeys.
The [component, section and journey audit](component-review.md) tracks coverage and
remaining gaps; earlier sampled-view grades are not whole-product acceptance.
The existing gem palette and entity artwork are retained. Screen pages identify
proposed placement changes; production is migrated by each implementation ticket.
[Spaces and file roles](spaces.md) covers SPN-078/079 explicitly.

Every UI change follows this playbook. A ticket that needs a pattern it doesn't
cover adds the pattern here in its own PR first (AGENTS.md).

Spinel should feel familiar to someone coming from Google Sheets, Excel for the
web, Apple Numbers or Zoho Sheet, and quieter than all four. Each screen page
compares those products, states the pattern Spinel adopts, and lists which
controls are always visible and which sit behind a menu.

| Screen                          | Page                         | Builds on it                                                                    |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| File list (dashboard)           | [dashboard.md](dashboard.md) | SPN-048, SPN-042, SPN-053, SPN-054, SPN-051, SPN-065, SPN-067, SPN-069          |
| Editor chrome                   | [editor.md](editor.md)       | SPN-049, SPN-043, SPN-042, SPN-050, SPN-033, SPN-035, SPN-068, SPN-072, SPN-075 |
| Doc formulas                    | [formulas.md](formulas.md)   | SPN-033                                                                         |
| Sharing                         | [sharing.md](sharing.md)     | SPN-066, SPN-071, SPN-081                                                       |
| Settings and sign-in            | [account.md](account.md)     | SPN-045, SPN-036, SPN-070                                                       |
| Admin                           | [admin.md](admin.md)         | SPN-032, SPN-061, SPN-064, SPN-082                                              |
| Guest view                      | [guest.md](guest.md)         | SPN-042, SPN-075                                                                |
| Empty, error and offline states | [states.md](states.md)       | SPN-053, SPN-054, SPN-042, SPN-051, SPN-052                                     |

SPN-047 redesigns these screens from a review of Storybook and competing
products, because the owner finds the current UI cluttered (chat 2026-10-19). It
updates these pages before the UI tickets above build on them. SPN-074 is the
first explicit exception: removing unsupported Slides could land before the redesign,
using the existing dashboard patterns and the usual stories, light/dark/phone
screenshots and owner approval. Owner, chat 2026-10-20, decision [#104](https://github.com/mxbaylee/spinel/issues/104).

The owner also authorized SPN-044 and SPN-034 (now landed) and SPN-033 before
the redesign (chat 2026-10-20; #113). Formula insertion follows
[formulas.md](formulas.md), with the same story and screenshot gates.

The starting point is the approved gem-rail mockup
(`git show 30a4a61^:docs/design/gem-rail-mockup.tsx`) and the landed SPN-027
theme in `src/ui/`. Initial research used public help pages and product blogs.
The owner also authorized live third-party UI research in Firefox on 2026-10-20
(decision #126). Describe interaction patterns; do not copy private content or
third-party assets into the proposal.

## Principles

1. **One primary action per view.** It uses `.primary`; everything else is a
   plain button. A view with two accent buttons has not decided what it is for.
2. **Visible means frequent.** A control is always visible only if most visits
   to that view use it. Everything else goes in the row's or view's **More**
   menu (`⋯`, accessible name "More actions for <name>").
3. **No hover-only controls.** The installed phone app (SPN-028) has no hover.
   Hover may reveal a label; it never reveals the only way to do something.
4. **Status changes never move the layout.** See
   [the pattern](#status-changes-never-move-the-layout).
5. **Say what happened and what to do.** Messages are one sentence with the next
   step: "Could not save. Try again." Never a code, never blame.
6. **Never color alone.** Every state has an icon or text as well as a color.
7. **Familiar words.** Use the words the four products share: New, Share,
   Rename, Move, Trash, Shared with me, View only, Can edit, Copy link.
8. **Guests see no identity.** Guest views show generic labels (SPN-016); design
   for a viewer who has no account.

## Tokens

The only color tokens are the theme's. `src/ui/palette.ts` is the source:
`src/ui/theme.ts` sets each entry as a `--<name>` CSS custom property on the
root, per mode. [docs/theme.md](../theme.md) explains the modes and fills. There
is no parallel token set; SPN-060's color lint enforces that.

| Token                                   | Use                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--sp-bg`                               | Page background                                                                                                             |
| `--sp-panel`                            | Raised surfaces: dialogs, menus, cards, fields                                                                              |
| `--sp-header`                           | Header and table-header bands                                                                                               |
| `--sp-text` / `--sp-muted`              | Body text / secondary text, timestamps                                                                                      |
| `--sp-border`                           | Dividers, field borders                                                                                                     |
| `--sp-accent` / `--sp-on-accent`        | The one primary button, focus, current item                                                                                 |
| `--sp-accent-2`                         | Secondary accent; never a second primary button                                                                             |
| `--sp-tint-1` / `--sp-tint-2`           | Selected row, active chip / a quieter highlight                                                                             |
| `--sp-select`                           | Translucent selection wash                                                                                                  |
| `--sp-rail` / `--sp-rail-ink`           | The rail only                                                                                                               |
| `--gem-1` … `--gem-6`, `--gem-edge`     | The gem artwork only                                                                                                        |
| `--fill-<role>-<soft\|strong>-<bg\|fg>` | The 16 fill presets: Sheet fills and profile colors (SPN-036); `--fill-error-soft-fg` is also alert text. Not other chrome. |

Contrast is tested in `src/ui/presetStyles.test.ts` (WCAG AA, both modes). A new
foreground/background pair joins that test in the same PR.

## Component foundation

SPN-047 installs [Base UI](https://base-ui.com/react/overview/about) alongside its
competitor review, using the existing React/Vite and plain CSS theme setup.
Base UI supplies unstyled interaction/accessibility primitives; the redesign
chooses visual styling, including any Material-like treatment. Shared components
used by the mockups get stories and keyboard, focus, touch and theme verification.
The shared controls and composed stories live in `src/ui/redesign/`. Consumer screen migrations remain in their implementation tickets. Use `npm run screenshots -- <story ids>` after building Storybook; see [review evidence](redesign.md#review-and-screenshots). Tailwind is
not currently installed and is not required for this adoption. Owner, chat
2026-10-20; [decision #120](https://github.com/mxbaylee/spinel/issues/120).
SPN-077's icon assets/current-surface integration can land first.

## Entity artwork

Docs, Sheets and planned Spaces use the [entity iconography pattern](entity-icons.md).
SPN-077 implemented the blue/green/purple facet family before the wider redesign;
Space examples remain in Storybook until the feature exists.

## Shell layout (SPN-047 proposal)

After owner approval, one optional navigation column replaces the old permanent
rail-plus-sidebar composition. File views use a 224 px sidebar containing gem,
places, pins and account utilities. Collapse leaves a 64 px rail with an
icon-only right chevron, named **Expand navigation** for assistive technology
and its tooltip. The left chevron collapses it; reopening restores the tree.
Never show both side by side.
Ordinary editors and Operator screens use compact horizontal utility navigation.
Spaces retain a full-width compact utility header above their internal tree and
editor. The tree has its own collapse chevron. When hidden, a local **Pages** control
below the site header reopens it. The top header reuses the tall navigation's
icons horizontally with fewer destinations: My files has no visible text, and
the website navigation has no expansion chevron.
Guests have only the linked Space's internal navigation, with no account exit.

The view header holds identity, status and actions. On phones, document identity
gets a complete first row; status and actions occupy the second row so a long
name cannot be squeezed out. Status retains its slot when text changes.

`Shell/AppLayout` shows the existing production shell. `Redesign/Screens`
shows the proposed compositions, including DashboardCollapsed and
PlannedSpaceCollapsed. Screen implementation tickets perform the migration.

## Layout and responsive

Storybook review widths: Phone 390, Tablet 768 and Desktop 1280. Existing
production rules remain until their screen migrates; the proposed rules below
supersede the earlier stacking layout after owner approval.

### Breakpoints

- **900 px and below:** file/Space navigation is a drawer by default, opened
  by the same chevron controls with accessible names and tooltips. Pins stay
  within that drawer, not a second row. Link guests use a scoped Pages control.
- **640 px and below:** compact top utilities replace a vertical rail; document
  headers use two rows, profile sections scroll with labels, Operator sections
  wrap so health is always discoverable. No 600 px intermediate behavior.
- **Coarse pointers and phones:** interactive targets are at least 44 × 44 px;
  compact visible artwork can sit inside that target, including appearance segments.
  The actual Sheet retains Univer's mobile behavior during migration.

### Shell sizes

- Expanded navigation: 224 px. Collapsed rail: 64 px; controls: 44 px.
- Main content fills remaining width. Dashboard gutters: 40 px desktop, 16 px
  phone. Editor content/Sheet may pan; page chrome must fit the viewport.
- Guest: no account rail. Space Pages navigation stays scoped to the link.
- Dialog: `min(480px, 100vw - 32px)`, capped at `100dvh - 32px` with scrolling.
- Fields are full width within their content section. Sheet dimensions and
  toolbar behavior stay with Univer, not the schematic mockup grid.

### Type

Use system UI fonts with no web font dependency. Proposed headings/section/body/
secondary sizes are 28/18/14/12 px. Compact metadata uses 10–11 px sparingly.
The serif sample document title is authored content, not application typography.
Existing production typography is not changed until its screen migration.

### Spacing

In use: 4, 6, 8, 12, 16, 20, 24, 28 and 32 px, plus rem equivalents in newer
components. Adopted scale: **4, 8, 12, 16, 24, 32 px**, with 20 and 28 kept only
where theme.css already uses them (body padding at phone width, dashboard gaps).
New CSS uses px for spacing and borders and rem for type and dialog widths.
These aren't CSS tokens yet, so SPN-060's lint covers color tokens and treats
this list as its spacing allowlist rather than inventing `--space-*` properties.

### Touch

44 px minimum for every target on a coarse pointer and for rail buttons
everywhere. No hover-only controls ([principle 3](#principles)). Full-height
layouts use `dvh` with a `vh` fallback so phone toolbars don't hide content.

## Patterns

### Status changes never move the layout

Save state, connection state and local-save state (SPN-053) all live in
fixed-size slots in the view header.

- The slot reserves the width of its longest label. An icon plus a short label
  ("Saved", "Saving…", "Offline", "Not saved"). The detail and any action sit in
  a popover from the slot, not inline.
- The settled state stays visible ("Saved"); it does not flash and disappear.
- `role="status"` and `aria-live="polite"`. Errors that need action also put a
  Retry button in the popover and keep the icon in its error state.
- One indicator per concern. SPN-053 adds local-save states to SPN-042's
  connection indicator rather than building a second one.

No component has this shape yet: today's `.save-status` grows in normal flow
(SPN-043). SPN-043 extracts it as `web/SaveStatus.tsx` with an
`Editor/SaveStatus` story covering every state, and SPN-042 adds its connection
states to the same component.

### Row

A list row is: kind icon, name (the open target, the whole row width), badges
(shared, view only, pinned), up to two tags then "+n", a muted secondary column
(edited or shared date), and a **More** button. Rows are at least 44 px tall.

### More menu

Native `<details>`/`<summary>` or a button with `aria-haspopup="menu"`. Items
are verbs in the shared vocabulary. Destructive items (Trash, Remove, Disable)
come last, after a divider. Closes on Escape and outside click; focus returns to
the button.

### Dialog

Sharing, tags, rename, move and confirmation all use a panel with a title, the
form, and actions bottom right: the primary action, then Cancel. Escape cancels.
A confirmation names the thing and the consequence: "Disable Sam Rivera? Their
documents and shares are kept."

### Chips and badges

Filter chips are toggle buttons with `aria-pressed`. Badges are text ("View
only", "Can edit", "Shared") and never interactive.

### Banner

For a condition that affects the whole view and isn't tied to one control ("A
successful offsite backup is overdue.", SPN-032's "Something is wrong"): a
full-width band at the top of the view body, under the header. An icon and a
status word, one sentence, and at most one link or action (usually to the
guide). Panel background with a `--sp-border` edge, and the alert color on the
icon and word only. `role="status"`, or `role="alert"` when action is needed.
One banner per view; it reserves no space when absent, so it is for conditions
present on load, not for status that changes while the view is open (that goes
in the header's status slots).

### Loading

A short `role="status"` line in the region that will fill ("Loading your
files…"). No spinners over the whole page, no skeletons that resize when the
content arrives.

## Storybook

```bash
npm run storybook
```

The catalogue from `main` is published at <https://mxbaylee.github.io/spinel/>.

Stories sit beside their components (`src/ui/*.stories.tsx`,
`web/*.stories.tsx`). The toolbar's theme switch shows Vintage (light) and
Modern (dark), and its viewport switch shows Phone, Tablet and Desktop; every
story works in both themes. `parameters.api` (from `.storybook/api.ts`) answers
the component's `fetch` calls: a JSON body, a `pending()` request for loading,
or a `failure()` for errors. Never mock a 401: the app's request helpers
redirect to sign-in.

- Set `parameters.api` in full on each story, never on the meta: Storybook
  deep-merges parameters, so a story's `failure()` for a key would merge into
  the meta's 200 body for that key and show the wrong state.
- Components that read `location` (`GuestApp`) get a per-story decorator that
  sets the path with `history.replaceState` and restores it on unmount.
- Some fixtures compute dates from `Date.now()` so they never look expired.
  SPN-060's screenshot comparisons must freeze the clock first.

Every reusable component has a story for each state it really has: empty,
loading, error and disabled. A PR that adds a component or a state adds the
story. Editors that boot Univer (`SheetEditor`, `DocEditor`, `VersionPreview`,
`HistoryBrowser`), `App.tsx`'s routing, and the sign-in, setup, invite and
recovery cards that are still inline in `App.tsx` are out of scope; SPN-060
covers them with Playwright screenshots instead. A ticket that extracts one of
those cards adds its story.

## Why it is shaped this way

- Start from the approved gem-rail mockup and the landed SPN-027 theme, so the
  redesign refines what the owner already approved. Owner, chat 2026-10-19.
- The dashboard and editor layouts are decided here so SPN-048 and SPN-049 only
  build; "status changes never move the layout" is a pattern because the editor
  jumped when its status grew (SPN-043). Owner, chat 2026-10-19.
- More minimal: every screen lists what is always visible and what sits behind a
  menu, so a reviewer can tell clutter from a decision. Owner, chat 2026-10-19.
- Markdown here plus Storybook stories beside the components, so the words and
  the rendered states stay next to what they describe. Storybook is a
  devDependency only. Owner, chat 2026-10-19.
- Two breakpoints, not three: theme.css grew 600, 640 and 900 px rules one
  ticket at a time, and the 600/640 pair leaves a 40 px band where the phone
  layout is half applied. Proposed in SPN-046, subject to the owner's review
  below.
- The tokens are the theme's (`src/ui/palette.ts`), not a parallel set, so there
  is one source of color and one contrast test.
- Public references and owner-authorized live UI research inform the patterns,
  without copying private content or third-party assets. Owner, chat 2026-10-20,
  decision #126; expands the original public-material research scope.
- The owner reviews this playbook before the UI tickets it unblocks start
  (SPN-046 owner input).

## Sources

Public help centres and product blogs: support.google.com (Docs Editors, Drive),
support.apple.com (Numbers for iCloud), help.zoho.com (Sheet, WorkDrive),
learn.microsoft.com and the Microsoft 365 Insider blog (Excel for the web,
OneDrive). Read 2026-10-19. Products change; when a comparison here goes stale,
update the comparison rather than the adopted pattern unless the owner agrees.

Owner refinement (chat, 2026-10-20): folders are rows in **My files**, while
pins remain navigation shortcuts. The expanded sidebar uses the original saturated `--sp-rail` pink and
matching `--sp-rail-ink` foreground (owner correction, 2026-10-20). A centered appearance picker sits above a profile row showing the user's display name; long names truncate with the full name in its title. Trash is a permanent
folder entry in My files with no rename/move/delete controls; it is not another
sidebar destination. A network icon beside the gem shows connection state,
with an accessible label and hover/focus/tap tooltip, dismissed outside or with Escape
without a Close button. Document save warnings
remain explicit; network state never substitutes for save confirmation.

Owner refinement (chat, 2026-10-20): offer **List and Grid** views over the same
files, filters and actions. Default to List; remember the preference during the
screen migration. Folders and permanent Trash appear in both. Desktop collapse
keeps My files, Shared with me and pins directly accessible, with full accessible
names and hover/focus labels; phone/tablet navigation stays in the drawer.
Space trees reopen from the local **Pages** control below the website header;
their nested folders and pages remain in the tree rather than becoming rail icons.

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
visible focus, 24 px visible segments and at least 44 px touch targets.
The control stays directly visible: centered horizontally above the profile row in expanded navigation
and in compact/phone headers, vertical in collapsed desktop rails. This device
reuses it and explains that appearance is local to this browser, defaults to System,
and is separate from saved profile identity. This supersedes the earlier explicit-menu proposal, retains
one theme store and follows OS changes while System is selected. The picker
must report a storage failure without undoing the in-session theme choice.
