# Settings and sign-in

## SPN-047 composed redesign proposal

Approved by the owner, 2026-10-21, [decision #126](https://github.com/mxbaylee/spinel/issues/126). Production implementation remains separate.
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Profile, Connections, ThisDevice, SignIn, Setup, Invite, Recovery, Consent, ConsentExpired.

| Current friction                                                                                                                     | Public reference pattern                                                                                 | Adopted proposal                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Appearance, passkeys and connections become a growing sequence of equal cards. Entry pages use oversized headings and heavy framing. | Notion exposes explicit appearance preferences; Dropbox separates account controls from file navigation. | A compact account area with section navigation; a quiet, single-task entry card. |

Proposed profile sections: Profile, Passkeys, This device, Connected assistants, and the planned owner-only Guest links inventory (SPN-066). Reuse the landed SPN-036 profile fields, Lucide picker and color presets, pending OAuth return navigation, disconnect and advanced token flows. Appearance is browser-local, defaults to System and lives in This device, separately from saved profile identity. Entry/consent screens keep every security disclosure and failure state; no marketing or signup route is introduced.

The approved proposal above governs placement during implementation. Existing behavioral and
permission rules below still apply; production migrations remain separate tickets.

## How others do it

|          | Google                                                            | Microsoft                            | Apple                   | Zoho            |
| -------- | ----------------------------------------------------------------- | ------------------------------------ | ----------------------- | --------------- |
| Theme    | Follows the OS; a theme option in settings, not in the editor     | Follows the OS; a toggle in settings | Follows the OS          | A theme setting |
| Profile  | Avatar top right opens the account menu (profile, sign out)       | Avatar top right: account, sign out  | Account menu            | Avatar menu     |
| Passkeys | Offered as an option on the sign-in page and in security settings | "Other ways to sign in"              | Built into the platform | Sign-in options |

The shared pattern: nobody gives theme a prominent picker; the avatar is where
the profile and sign-out live; passkeys are one sign-in option among several.

## Spinel today

The rail has Settings and Sign out links. `/settings` shows Appearance
(`ThemeSettings`), Your profile (display name, color and icon), and Your passkeys. The Settings link uses the saved profile icon; SPN-045 will move it to the planned rail position. Sign-in, setup, invite and recovery are
single-purpose pages with one heading, one explanation and one primary button.

## Adopted pattern

- **Appearance** uses directly visible System / Light / Dark icon segments,
  with one browser-local preference store and System as the default. Segments are
  24 px on pointer desktops, inside a 30 px pill. Devices with any coarse pointer
  use 44 × 44 px targets around the same 24 px visible circles; the pill remains
  30 px high (or wide in a vertical rail). Expanded navigation and
  compact/phone headers use a horizontal group; collapsed desktop rails stack it
  vertically. This device explains the scope and storage-failure behavior.
- **Your profile** opens from the account control. Name, color and icon are saved
  account identity; Passkeys, This device and Connections are separate sections.
  Appearance is not part of the saved identity form. Preserve Sign out and return
  navigation to the prior file or administration context.
- **Profile color** (SPN-036) uses the 16 `fillPresets` laid out like the cell
  palette; the icon is drawn in the preset's text color. Icon search is a field
  with a grid of results, not a dropdown.
- **Homepage / sign-in:** one arrival screen with the gem, “Your workspace.”,
  a short description, and **Sign in with a passkey** with a small decorative key
  icon. Existing sign-in links render the same screen. There is no intermediate
  Sign in step. Pending, cancellation and retry stay on this page.
- **Need help?** appears once below the entry form on arrival, invitation,
  recovery and setup screens. It opens shared invitation/recovery guidance and
  expandable Operator commands. “Need access?” is no longer a separate label.
  Owner, chat 2026-10-20, decision #126.
- **Setup, invite, recovery** share the quiet entry layout but retain their
  distinct requirements. Invite requires a name; recovery names the existing
  account and explains replacement of old passkeys and sessions. Setup explains
  the Operator/everyday-account separation. See the [walkthrough](walkthrough.md)
  for pending, cancellation, invalid-link and help states.

### Always visible / behind a menu

| Always visible                                                   | Behind a menu                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Navigation: appearance segments, account control                 | Future, not built: passkey row More → Remove (needs its own ticket) |
| Settings: identity, Passkeys, This device, Connections, Sign out |                                                                     |
| Sign-in: one primary button                                      |                                                                     |

## Stories

`Settings/ThemeSettings`, `Shell/GemLogo` (the sign-in card's mark). The rail has `Shell/Rail`. `Account/Profile` covers loading, editing, saving and errors; `Account/Icon picker` covers the searchable grid; `Editor/Profile cursor label` and `Editor/Collaborators` show presence appearances.

## Assistant access (SPN-034)

Online everyday-account settings add **Connected assistants** after passkeys. The
existing card/list pattern shows the MCP endpoint, supplied client label, callback
origin, created/last-used times and **Disconnect**. **Advanced: personal access
tokens** keeps custom labels, last use and **Revoke** in a disclosure. Its once-only
secret reveal and copy fallback reuse the invite-link pattern. Admin and offline
settings do not offer connection approval or token creation.

`/connect` reuses the single-purpose account card and existing **Allow / Cancel**
actions. Show the signed-in account, unverified client-supplied name, callback
origin, requested read/edit capabilities and a reminder to approve only a request
the person started. Existing passkey sign-in resumes the opaque pending request.
Expired, unavailable-session and admin states explain how to start again; no
trusted-client badges or arbitrary return URLs. This applies existing patterns,
without changing the planned profile redesign.

Stories: `Settings/AssistantConnections`, `Settings/ConnectAssistant`, and
`Settings/AccessTokens` cover loading, empty, busy, failure, consent, expiration,
reveal and revoked states. See [MCP](../mcp.md), decision
[#111](https://github.com/mxbaylee/spinel/issues/111), owner correction 2026-10-20.

Owner selection (chat, 2026-10-20): **System / Light / Dark** is a three-segment
icon control (monitor, sun, moon), with a circular selected surface. Use Base UI
RadioGroup/Radio for single selection and arrow-key behavior, accessible names,
visible focus, 24 px pointer-desktop segments inside a 30 px pill, and 44 × 44 px
targets on devices with any coarse pointer. Touch retains the same 24 px visible
circles and 30 px pill thickness. Expanded navigation shows the control
on its own row above Profile. Collapsed desktop navigation stacks its segments vertically; compact/phone headers show it horizontally;
This device reuses it. This supersedes the earlier explicit-menu proposal, retains
one theme store and follows OS changes while System is selected. The picker
must report a storage failure without undoing the in-session theme choice.

## Saved profile behaviour (SPN-036)

- Profiles contain a display name, one of the 16 fill presets, a Lucide catalog icon, and the existing passkey list. Icon strokes use the preset text color. New users start with `user-round` and a name-derived color (owner, 2026-10-17).
- The icon dialog searches names, Lucide tags, local synonyms and typos (`flowre` finds Flower). Category and search combine; blank search shows all non-alias icons, 60 at a time, with Show more. Arrow Down enters the grid; arrows/Home/End navigate; Enter picks; Escape cancels and restores focus. It uses the existing dialog and palette patterns, before the redesign (owner, 2026-10-20).
- Store `lucide:<name>` and validate against the pinned catalog. Search/reference code now lives in `src/profile/`; no emojis or photos. Names are 1–80 characters with no control characters. Saving updates the rail immediately; reopen editors to refresh their membership appearance.
- Account-only room badges and Sheet canvas labels use saved icons/colors. Guest-linked rooms keep generic names, empty personal avatars and default ID-derived colors (#72); generic user-round glyphs reveal no profile identity. Settings explains this distinction.
- Sheet labels have rounded corners and include icon plus name. Following reveals an offscreen range without overwriting the local selection or scrolling an already-visible range. Doc canvas colors remain with SPN-058; native Docs services stay enabled. Owner approval, 2026-10-20, [decision #127](https://github.com/mxbaylee/spinel/issues/127).

SPN-036 merged at `6c09bd4` and is included in this branch. Profile fixtures reuse
its real `IconPicker`, `ProfileIcon`, catalog and sixteen fill presets. Save in
the prototype updates only the local preview/avatar; production profile persistence
and guest-identity behavior remain SPN-036's existing implementation. The deferred
SPN-086 document emoji/icon picker is separate from this already-shipped user picker.

Owner refinement (chat, 2026-10-20): Need help keeps member access guidance first
and provides an expandable Operator section. Show verified `npm run setup` and
its documented Docker equivalent, explain zero-user/30-minute/replacement limits,
and keep setup links private. `npm run passkey:check` is explicitly a disposable
development diagnostic, not account recovery. Existing-account recovery uses
an authorized Operator invitation. Backup help shows the documented configured
Docker command. This page displays commands and never executes them.

The arrival-screen gem reuses the existing brief `gem-wiggle` on hover or keyboard
focus. Respect reduced motion; the wordmark stays still. Owner, chat 2026-10-20.
