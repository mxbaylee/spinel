# Settings and sign-in

## SPN-047 composed redesign proposal

Awaiting [owner approval](https://github.com/mxbaylee/spinel/issues/126).
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — Profile, Connections, ThisDevice, SignIn, Setup, Invite, Recovery, Consent, ConsentExpired.

| Current friction | Public reference pattern | Adopted proposal |
| --- | --- | --- |
| Appearance, passkeys and connections become a growing sequence of equal cards. Entry pages use oversized headings and heavy framing. | Notion exposes explicit appearance preferences; Dropbox separates account controls from file navigation. | A compact account area with section navigation; a quiet, single-task entry card. |

Proposed profile sections: Profile & appearance, Passkeys, Connected assistants, This device, and the planned owner-only Guest links inventory (SPN-066). Preserve name/color/icon work in PR #124, pending OAuth return navigation, disconnect and advanced token flows. Theme is a three-choice rail menu using the same preference as Profile; this replaces SPN-045’s provisional cycling form only after owner approval. Entry/consent screens keep every security disclosure and failure state; no marketing or signup route is introduced.

The proposal above governs placement after approval. Existing behavioral and
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
(`ThemeSettings`), Your profile (display name, colour and icon), and Your passkeys. The Settings link uses the saved profile icon; SPN-045 will move it to the planned rail position. Sign-in, setup, invite and recovery are
single-purpose pages with one heading, one explanation and one primary button.

## Adopted pattern

- **Theme** is a three-choice rail menu (Follow system, Vintage · Light,
  Modern · Dark), proposed in #126. Profile keeps the same named choices and
  storage-failure explanation. Both controls use one preference store. Owner
  approval replaces the earlier cycling proposal before SPN-045 implements it.
- **Your profile** replaces Settings (SPN-045). The rail avatar opens it;
  `/settings` redirects there. Sections, in order: Name, colour and icon
  (SPN-036), Appearance, Your passkeys. **Sign out** is the page's header
  action, top right.
- **Profile colour** (SPN-036) uses the 16 `fillPresets` laid out like the cell
  palette; the icon is drawn in the preset's text colour. Icon search is a field
  with a grid of results, not a dropdown.
- **Sign-in:** a passkey is the only way in, so unlike the four products it is
  the primary button, not "other ways". The page is the gem, "Sign in", one
  sentence ("Use a passkey from your browser, password manager or phone."), and
  the button. Errors replace the sentence's line in place, so the button doesn't
  move.
- **Setup, invite, recovery** share that one-card layout; only the heading,
  sentence and button label change.

### Always visible / behind a menu

| Always visible                                              | Behind a menu                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Rail: theme button, avatar                                  | Future, not built: passkey row More → Remove (needs its own ticket) |
| Profile: name, colour, icon, appearance, passkeys, Sign out |                                                                     |
| Sign-in: one primary button                                 |                                                                     |

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
visible focus and at least 44 px targets. Expanded navigation shows the control
on its own row above Profile. Collapsed/phone utilities open it in a popover;
Profile reuses it. This supersedes the earlier explicit-menu proposal, retains
one theme store and follows OS changes while System is selected. The picker
must report a storage failure without undoing the in-session theme choice.

## Saved profile behaviour (SPN-036)

- Profiles contain a display name, one of the 16 fill presets, a Lucide catalog icon, and the existing passkey list. Icon strokes use the preset text colour. New users start with `user-round` and a name-derived colour (owner, 2026-10-17).
- The icon dialog searches names, Lucide tags, local synonyms and typos (`flowre` finds Flower). Category and search combine; blank search shows all non-alias icons, 60 at a time, with Show more. Arrow Down enters the grid; arrows/Home/End navigate; Enter picks; Escape cancels and restores focus. It uses the existing dialog and palette patterns, before the redesign (owner, 2026-10-20).
- Store `lucide:<name>` and validate against the pinned catalog. Search/reference code now lives in `src/profile/`; no emojis or photos. Names are 1–80 characters with no control characters. Saving updates the rail immediately; reopen editors to refresh their membership appearance.
- Account-only room badges and Sheet canvas labels use saved icons/colours. Guest-linked rooms keep generic names, empty personal avatars and default ID-derived colours (#72); generic user-round glyphs reveal no profile identity. Settings explains this distinction.
- Sheet labels have rounded corners and include icon plus name. Following reveals an offscreen range without overwriting the local selection or scrolling an already-visible range. Doc canvas colours remain with SPN-058; native Docs services stay enabled. Owner approval, 2026-10-20, [decision #127](https://github.com/mxbaylee/spinel/issues/127).
