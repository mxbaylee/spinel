# Review the Spinel walkthrough

This is the connected SPN-047 design proposal in [PR #125](https://github.com/mxbaylee/spinel/pull/125).
It uses rendered Storybook screens and local fixture state. It does not sign in,
change a real account, or save a document. Production migration remains separate.

The [visual gallery](review/README.md) records the captured commit, workflow result
and unchanged PNG sources. Its **Before** images are explicitly labeled as either
production routes or existing Storybook components. They are comparison evidence,
not the new walkthrough. The homepage is proposed; production currently sends
signed-out arrivals directly to sign-in.

## Open and navigate

Download **storybook-review** from the proposal workflow linked in the gallery,
extract it, and serve the extracted static files locally without rebuilding.
Open **Redesign → Walkthrough** in Storybook. Start with Owner, Collaborator,
Operator or LinkGuest. The **design-review** artifact contains all rendered states
and its HTML screenshot index. A capture can exist even when a later journey
assertion fails; check the workflow result independently.

Use the product's buttons, file rows and navigation to move between screens.
Expand **Design walkthrough · … · local preview** only to choose a **Preview
event**, such as a passkey succeeding or a connection failing. These event
controls are review tools, not proposed product controls. **Restart walkthrough**
resets the fixture. Edits and uploads do not persist outside the preview.

## Four journeys to try

1. **Owner:** start at the [homepage](review/homepage-light.png),
   [sign in](review/sign-in-phone.png), and simulate Passkey succeeded. Find a
   file using search, switch List/Grid, collapse navigation, open a
   [Doc](review/journey-owner-doc-1280.png) or [Sheet](review/sheet-light.png), and return to
   the same file context. Visit [Settings](review/journey-device-settings-390.png), change
   profile identity, and return. Open history and inspect restore confirmation.
   Simulate a failed save before leaving to inspect the
   [unsaved-work warning](review/journey-save-failed-390.png).
2. **Collaborator:** sign in to the shared file and read its Can edit role. Edit,
   inspect save state, visit settings, and return. Look for a clear distinction
   between content editing and owner-controlled sharing or deletion. Profile
   changes stay separate from browser appearance.
3. **Operator:** begin at [setup](review/setup-phone.png). Read the account
   separation, simulate passkey success, and follow the first-run everyday-account
   invitation into [Administration](review/journey-operator-first-run-1280.png). Choose
   [invitation purpose and expiry](review/journey-operator-invite-form-390.png),
   inspect the once-only address/copy result, and explore
   recovery, passkeys, disable confirmation and backups. Check the
   [unavailable setup link](review/invalid-setup-phone.png) and
   [Operator help](review/operator-help-phone.png). Help shows commands and
   prerequisites; the page never executes them. Operators gain no document access.
4. **Link guest:** start at the [shared Doc](review/guest-viewer-phone.png), then
   use preview events to open the [shared Sheet](review/guest-sheet-phone.png)
   and switch Viewer/Editor access. Simulate [connection loss](review/journey-guest-disconnected-390.png) while the document
   is open, then reopening while offline: these are different states. Finally,
   [turn off the link](review/journey-guest-revoked-390.png) and check that document identity, content and actions all
   disappear. Guests have no account navigation or private offline catalog.

## What to judge

Can each person identify their next action, understand their access and tell
whether work is safe? Does returning preserve useful context? Is navigation
worth the space it occupies on desktop, and reachable on a phone? Check light,
dark and phone captures from the same proposal source before approving.

System / Light / Dark stays directly visible as a three-segment control. It is
32 px per segment on pointer desktops and at least 44 px on touch; collapsed
desktop rails stack it vertically, while headers and expanded navigation use a
horizontal group. It defaults to System and affects this browser only. **This
device** explains that scope; saving profile identity does not change appearance.

Approve the composed direction and its screenshots in the PR when ready, or
identify the screen and task that still feels awkward. The gallery is review
evidence, not owner approval or proof that every CI gate passed.
