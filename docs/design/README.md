# Spinel design playbook

Every UI change follows this playbook. A ticket that needs a pattern it doesn't
cover adds the pattern here in its own PR first (AGENTS.md).

Spinel should feel familiar to someone coming from Google Sheets, Excel for the
web, Apple Numbers or Zoho Sheet, and quieter than all four. Each screen page
compares those products, states the pattern Spinel adopts, and lists which
controls are always visible and which sit behind a menu.

| Screen | Page | Builds on it |
|---|---|---|
| File list (dashboard) | [dashboard.md](dashboard.md) | SPN-048, SPN-042, SPN-039, SPN-051 |
| Editor chrome | [editor.md](editor.md) | SPN-049, SPN-043, SPN-042, SPN-050, SPN-033, SPN-035, SPN-009, SPN-013 |
| Sharing | [sharing.md](sharing.md) | SPN-033 |
| Settings and sign-in | [account.md](account.md) | SPN-045, SPN-036 |
| Admin | [admin.md](admin.md) | SPN-032 |
| Guest view | [guest.md](guest.md) | SPN-042 |
| Empty, error and offline states | [states.md](states.md) | SPN-039, SPN-042, SPN-051, SPN-052 |

The starting point is the approved gem-rail mockup
(`git show 30a4a61^:docs/design/gem-rail-mockup.tsx`) and the landed SPN-027
theme in `src/ui/`. The audit used public help pages and product blogs only; no
third-party product was signed in to, and patterns are described, not copied.

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
6. **Never colour alone.** Every state has an icon or text as well as a colour.
7. **Familiar words.** Use the words the four products share: New, Share,
   Rename, Move, Trash, Shared with me, View only, Can edit, Copy link.
8. **Guests see no identity.** Guest views show generic labels (SPN-016);
   design for a viewer who has no account.

## Tokens

The only tokens are the theme's, listed in [docs/theme.md](../theme.md) and
defined in `src/ui/palette.ts`. There is no parallel design-token set; SPN-047's
token lint enforces that.

| Token | Use |
|---|---|
| `--sp-bg` | Page background |
| `--sp-panel` | Raised surfaces: dialogs, menus, cards |
| `--sp-text` / `--sp-muted` | Body text / secondary text, timestamps |
| `--sp-border` | Dividers, field borders |
| `--sp-accent` / `--sp-on-accent` | The one primary button, focus, current item |
| `--sp-tint-1` | Selected row, active chip |
| `--sp-rail` / `--sp-rail-ink` | The rail only |
| `fillPresets` (16) | Sheet fills and profile colours (SPN-036). Not shell chrome. |

Contrast is tested in `src/ui/presetStyles.test.ts` (WCAG AA, both modes). A new
foreground/background pair joins that test in the same PR.

## Shell layout

```
┌──────┬─────────────┬───────────────────────────────────────────┐
│ rail │ sidebar     │ view header (fixed height)                │
│ gem  │ (dashboard  ├───────────────────────────────────────────┤
│ docs │  only)      │ view body                                 │
│ admin│             │                                           │
│  ··· │             │                                           │
│ theme│ connection  │                                           │
│ you  │ indicator   │                                           │
└──────┴─────────────┴───────────────────────────────────────────┘
```

- **Rail:** gem (links to Your docs), Your docs, Admin (admins only), a spacer,
  then the theme button and the avatar (SPN-045). Icon-only with accessible
  names; labels show on hover and focus. Today the rail is inline in
  `web/App.tsx`. Extract it into `web/Rail.tsx` with a story when SPN-045
  touches it.
- **Sidebar:** dashboard only. Collapses behind a menu button under 900 px.
- **View header:** one row, fixed height, holding the view's title, its status
  and its actions. Nothing below it moves when status changes.

## Patterns

### Status changes never move the layout

Save state, connection state, local-save state (SPN-039) and queue position
(SPN-013) all live in fixed-size slots in the view header.

- The slot reserves the width of its longest label. An icon plus a short label
  ("Saved", "Saving…", "Offline", "Not saved"). The detail and any action sit
  in a popover from the slot, not inline.
- The settled state stays visible ("Saved"); it does not flash and disappear.
- `role="status"` and `aria-live="polite"`. Errors that need action also put a
  Retry button in the popover and keep the icon in its error state.
- One indicator per concern. SPN-039 adds local-save states to SPN-042's
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
come last, after a divider. Closes on Escape and outside click; focus returns
to the button.

### Dialog

Sharing, tags, rename, move and confirmation all use a panel with a title, the
form, and actions bottom right: the primary action, then Cancel. Escape cancels.
A confirmation names the thing and the consequence: "Disable Sam Rivera? Their
documents and shares are kept."

### Chips and badges

Filter chips are toggle buttons with `aria-pressed`. Badges are text
("View only", "Can edit", "Shared") and never interactive.

### Loading

A short `role="status"` line in the region that will fill ("Loading your
files…"). No spinners over the whole page, no skeletons that resize when the
content arrives.

## Storybook

```bash
npm run storybook
```

Stories sit beside their components (`src/ui/*.stories.tsx`,
`web/*.stories.tsx`). The toolbar's theme switch shows Vintage (light) and
Modern (dark); every story works in both. `parameters.api` (from
`.storybook/api.ts`) answers the component's `fetch` calls: a JSON body, a
`pending()` request for loading, or a `failure()` for errors. Never mock a 401:
the app's request helpers redirect to sign-in.

- Set `parameters.api` in full on each story, never on the meta: Storybook
  deep-merges parameters, so a story's `failure()` for a key would merge into
  the meta's 200 body for that key and show the wrong state.
- Components that read `location` (`GuestApp`) get a per-story decorator that
  sets the path with `history.replaceState` and restores it on unmount.
- Some fixtures compute dates from `Date.now()` so they never look expired.
  SPN-047's screenshot comparisons must freeze the clock first.

Every reusable component has a story for each state it really has: empty,
loading, error and disabled. A PR that adds a component or a state adds the
story. Editors that boot Univer (`SheetEditor`, `DocEditor`, `VersionPreview`,
`HistoryBrowser`) and `App.tsx`'s routing are out of scope; SPN-047 covers them
with Playwright screenshots instead.

## Why it is shaped this way

- Start from the approved gem-rail mockup and the landed SPN-027 theme, so the
  redesign refines what the owner already approved. Owner, chat 2026-10-19.
- The dashboard and editor layouts are decided here so SPN-048 and SPN-049 only
  build; "status changes never move the layout" is a pattern because the editor
  jumped when its status grew (SPN-043). Owner, chat 2026-10-19.
- More minimal: every screen lists what is always visible and what sits behind
  a menu, so a reviewer can tell clutter from a decision. Owner, chat
  2026-10-19.
- Markdown here plus Storybook stories beside the components, so the words and
  the rendered states stay next to what they describe. Storybook is a
  devDependency only. Owner, chat 2026-10-19.
- The tokens are the theme's (docs/theme.md), not a parallel set, so there is
  one source of colour and one contrast test.
- Public material only, patterns described not copied, so nothing here depends
  on a third-party account or someone else's assets. Grooming, 2026-10-19.
- The owner reviews this playbook before the UI tickets it unblocks start
  (SPN-046 owner input).

## Sources

Public help centres and product blogs: support.google.com (Docs Editors, Drive),
support.apple.com (Numbers for iCloud), help.zoho.com (Sheet, WorkDrive),
learn.microsoft.com and the Microsoft 365 Insider blog (Excel for the web,
OneDrive). Read 2026-10-19. Products change; when a comparison here goes stale,
update the comparison rather than the adopted pattern unless the owner agrees.
