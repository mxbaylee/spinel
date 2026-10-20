# Settings and sign-in

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
(`ThemeSettings`) and Your passkeys. Sign-in, setup, invite and recovery are
single-purpose pages with one heading, one explanation and one primary button.

## Adopted pattern

- **Theme** is the rail's theme button (SPN-045). Provisional: SPN-045's default
  is one button cycling Follow system → Vintage → Modern, with its current state
  as the accessible name, but its owner input ("confirm the theme switch's
  form") is still open. Update this line with the confirmed form. `/settings`
  keeps the full `ThemeSettings` radio group and its storage-failure
  explanation, because the button alone can't explain why a choice won't stick.
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

`Settings/ThemeSettings`, `Shell/GemLogo` (the sign-in card's mark). The rail
gets `Shell/Rail` when SPN-045 extracts it; profile fields get stories with
SPN-036.

## Assistant access (SPN-034)

Online everyday-account settings add an **Assistant access tokens** card after passkeys.
It uses the existing labelled field/button/list pattern: name, **Create token**,
and token rows with created/last-used status and **Revoke**. The once-only secret
reveal and **Copy token** with manual-copy fallback reuse the invite-link pattern.
Show the endpoint and what access the token grants in plain text. Loading, empty,
busy, error, revealed and revoked states have `Settings/AccessTokens` stories.
Admins and offline settings do not offer token creation. See [MCP](../mcp.md),
decision [#111](https://github.com/mxbaylee/spinel/issues/111).
