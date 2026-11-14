# Review current Spinel UI

The [Storybook catalog](https://mxbaylee.github.io/spinel/) opens production
components and local API fixtures. The old SPN-047 connected walkthrough and
its duplicate screen mockups have been retired because their controls drifted
from the application. Historical design evidence remains in [the review gallery](review/README.md).

## Where to review

- **Current production → Appearance:** the actual icon/emoji/color and cover
  controls, plus all paired gem artwork. Change item type in Controls and use
  the theme toolbar for light/dark. This is local preview state.
- **Current production → Editor → Frame:** the real editor header, rename,
  identity, save/status, modal and responsive geometry states. Its labelled
  geometry fixture does not simulate the document service.
- **Current production → Dashboard, Spaces, Account, Admin and Guest:** the
  respective shipped components with success, pending, error and permission
  fixtures. These do not sign in or modify a real account.
- **Native fixtures → Editors:** isolated Univer input, selection, menu and
  viewer regression cases. They are not a full application or a claim of mobile
  Doc wrapper parity. Production Playwright journeys verify the real routes,
  editors, permissions, persistence and offline behavior.
- **Current production → Account → Guest links:** the actual owner inventory,
  expiry dialog, loading/error/expired states and stale-action safeguards.
  Your profile also shows its integrated section. No Redesign catalog remains.

Every UI ticket follows the [production migration rule](../implementation/storybook-production-migration.md).
The merged SPN-055 device-storage stories now use DeviceStoragePanel; its old
This device mock is retired. Shared controls under the `src/ui/redesign/`
source folder still used by the app are production components regardless of
that historical directory name.

## Published preview and verification

The shared URL can be replaced by a newer main or PR deployment. Check
[build identity](https://mxbaylee.github.io/spinel/sha.json) for its source SHA,
branch, PR and workflow. PR descriptions carry durable commit-pinned images.
A successful preview build is not itself an independent visual review.

Run `npm run storybook` locally. Review production states at light/dark desktop,
phone and tablet sizes; the screenshot workflow also executes story interactions.
Use `npm run screenshots -- <story ids>` after building Storybook for focused
captures. Local API fixtures model responses; end-to-end application tests
remain the evidence for actual backend behavior.
