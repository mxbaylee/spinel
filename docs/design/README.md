# Spinel design playbook

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
| Doc formulas                    | [formulas.md](formulas.md) | SPN-033 |
| Sharing                         | [sharing.md](sharing.md)     | SPN-033, SPN-066, SPN-071, SPN-076                                                       |
| Settings and sign-in            | [account.md](account.md)     | SPN-045, SPN-036, SPN-070                                                       |
| Admin                           | [admin.md](admin.md)         | SPN-032, SPN-061, SPN-064                                                       |
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
8. **Guests see no identity.** Guest views show generic labels (SPN-016); design
   for a viewer who has no account.

## Tokens

The only colour tokens are the theme's. `src/ui/palette.ts` is the source:
`src/ui/theme.ts` sets each entry as a `--<name>` CSS custom property on the
root, per mode. [docs/theme.md](../theme.md) explains the modes and fills. There
is no parallel token set; SPN-060's colour lint enforces that.

| Token                                   | Use                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--sp-bg`                               | Page background                                                                                                              |
| `--sp-panel`                            | Raised surfaces: dialogs, menus, cards, fields                                                                               |
| `--sp-header`                           | Header and table-header bands                                                                                                |
| `--sp-text` / `--sp-muted`              | Body text / secondary text, timestamps                                                                                       |
| `--sp-border`                           | Dividers, field borders                                                                                                      |
| `--sp-accent` / `--sp-on-accent`        | The one primary button, focus, current item                                                                                  |
| `--sp-accent-2`                         | Secondary accent; never a second primary button                                                                              |
| `--sp-tint-1` / `--sp-tint-2`           | Selected row, active chip / a quieter highlight                                                                              |
| `--sp-select`                           | Translucent selection wash                                                                                                   |
| `--sp-rail` / `--sp-rail-ink`           | The rail only                                                                                                                |
| `--gem-1` … `--gem-6`, `--gem-edge`     | The gem artwork only                                                                                                         |
| `--fill-<role>-<soft\|strong>-<bg\|fg>` | The 16 fill presets: Sheet fills and profile colours (SPN-036); `--fill-error-soft-fg` is also alert text. Not other chrome. |

Contrast is tested in `src/ui/presetStyles.test.ts` (WCAG AA, both modes). A new
foreground/background pair joins that test in the same PR.

## Planned component foundation

SPN-047 adopts [Base UI](https://base-ui.com/react/overview/about) alongside its
competitor review, using the existing React/Vite and plain CSS theme setup.
Base UI supplies unstyled interaction/accessibility primitives; the redesign
chooses visual styling, including any Material-like treatment. Shared components
used by the mockups get stories and keyboard, focus, touch and theme verification.
Consumer screen migrations remain in their implementation tickets. Tailwind is
not currently installed and is not required for this adoption. Owner, chat
2026-10-20; [decision #120](https://github.com/mxbaylee/spinel/issues/120).
SPN-077's icon assets/current-surface integration can land first.

## Entity artwork

Docs, Sheets and planned Spaces use the [entity iconography pattern](entity-icons.md).
SPN-077 implements the blue/green/purple facet family before the wider redesign;
Space examples remain in Storybook until the feature exists.

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
  names; labels show on hover and focus. It lives in `web/Rail.tsx`
  (`Shell/Rail`); SPN-045 changes its contents.
- **Sidebar:** dashboard only. See
  [Layout and responsive](#layout-and-responsive) for how it stacks at narrower
  widths.
- **View header:** one row, fixed height, holding the view's title, its status
  and its actions. Nothing below it moves when status changes.

Story: `Shell/AppLayout` renders the whole shell (rail, pinned sidebar,
dashboard) at Desktop, Tablet and Phone.

## Layout and responsive

Values from `src/ui/theme.css` today. Storybook's viewport toolbar has the same
three widths (Phone 390, Tablet 768, Desktop 1280); check a layout change at all
three.

### Breakpoints

| Width    | Today in theme.css                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≤ 900 px | The pinned sidebar stacks above the content (its list wraps into a row). With a coarse pointer, buttons, selects and inputs are at least 44 px tall and the Sheet uses Univer's mobile controls at `max(420px, 70dvh)`. |
| ≤ 640 px | The rail becomes a sticky top bar (labels drop below the buttons); body padding 32 → 20 px; the fill palette goes 8 → 4 columns.                                                                                        |
| ≤ 600 px | The dashboard's folder sidebar stacks above the file list with a divider.                                                                                                                                               |

Adopted: **two breakpoints, 640 px (phone) and 900 px (tablet / touch)**. The
600 px rules move to 640 px when the next ticket touches them, so a phone never
sits between "rail on top" and "sidebar beside the list". Don't add a third. For
SPN-048, at ≤ 640 px the folder sidebar collapses behind a **Folders** button in
the view header instead of stacking; at ≤ 900 px pinned items stay a wrapped row
above the content, as today.

### Shell sizes

- **Rail:** 64 px column, 44 px square buttons, full height (`100dvh`, sticky).
- **Body:** fills the rest; padding 32 px, 20 px at ≤ 640 px. No max width on
  the shell; the rail layout overrides the old 1080/1480 px caps.
- **Dashboard grid:** folder sidebar `minmax(150px, 230px)`, gap 28 px. With
  pins: pinned column 220 px, gap 28 px.
- **Guest page:** no rail; padding `clamp(16px, 3vw, 32px)`.
- **Dialogs:** `min(32rem, 100vw - 2rem)` (confirmations) or
  `min(30rem, 100vw - 3rem)` (tags), height capped at `100vh - 3rem` with
  scrolling. New dialogs use the first.
- **Fields:** full width up to 600 px.
- **Sheet canvas:** 640 px tall, at least 400 px (mobile rule above).

### Type

`ui-rounded, system-ui, sans-serif`; no web fonts. Page title (h1)
`clamp(32px, 6vw, 44px)` with −0.04em tracking; section heading (h2) 22 px; body
16 px at line height 1.6; secondary text 14 px; small labels and badges 0.85rem
/ 12 px. `clamp()` is for page titles and page padding only; body text doesn't
scale with the viewport.

### Spacing

In use: 4, 6, 8, 12, 16, 20, 24, 28 and 32 px, plus rem equivalents in newer
components. Adopted scale: **4, 8, 12, 16, 24, 32 px**, with 20 and 28 kept only
where theme.css already uses them (body padding at phone width, dashboard gaps).
New CSS uses px for spacing and borders and rem for type and dialog widths.
These aren't CSS tokens yet, so SPN-060's lint covers colour tokens and treats
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
guide). Panel background with a `--sp-border` edge, and the alert colour on the
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
  is one source of colour and one contrast test.
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
