# SPN-095 production recovery captures

These six unmodified PNGs show the real account recovery routes with synthetic
Owners, Editors, names and deletion dates in disposable local databases. They
were captured by the passing `production` scenarios in
[`e2e/spaces.spec.ts`](../../../../e2e/spaces.spec.ts), not by Storybook fixtures.

The production UI was captured at local source snapshot
`e439d914645b3b8b060e037b11e71dbc75b61cde` and is unchanged in the reviewed source
snapshot `38976fe0e26c8ea9715780fb1985254d15a88acc`. The latter only strengthens
the expired missing-location Storybook fixture and assertion. Local capture used
Google Chrome **156.0.8078.47** as a fallback after the pinned Playwright browser
download failed. The images are local, pre-CI evidence; they do not establish a
hosted CI, pinned-browser matrix or full Storybook pass.

The originating scenarios are:

- **SPN-095 internal Trash shows the same deadline to owners and editors, refuses expired recovery and preserves independent batches** — account route `/spaces/<spaceId>?trash=1`.
- **SPN-095 outer Trash expires whole Spaces and their enclosing folders without closing younger recovery windows** — account route `/?trash=1`.

The internal phone capture uses a touch/mobile browser context. The outer phone
capture uses a desktop context resized to the phone viewport. Every PNG's actual
dimensions match the viewport listed below. No crop, resize or other image
manipulation was applied.

| File | View | Account role | Theme | Viewport and PNG dimensions |
| --- | --- | --- | --- | --- |
| [internal-owner-light.png](internal-owner-light.png) | Internal Space Trash, recoverable and expired independent batches | Owner | Light | 1440 × 1100 |
| [internal-owner-dark.png](internal-owner-dark.png) | Internal Space Trash, recoverable and expired independent batches | Owner | Dark | 1440 × 1100 |
| [internal-editor-phone-light.png](internal-editor-phone-light.png) | Internal Space Trash, with no owner-only permanent-delete menu | Editor | Light | 390 × 844 |
| [outer-owner-light.png](outer-owner-light.png) | Outer Trash, younger Space and expired Space/folder group | Owner | Light | 1440 × 1100 |
| [outer-owner-dark.png](outer-owner-dark.png) | Outer Trash, younger Space and expired Space/folder group | Owner | Dark | 1440 × 1100 |
| [outer-owner-phone-light.png](outer-owner-phone-light.png) | Outer Trash, younger Space and expired Space/folder group | Owner | Light | 390 × 844 |

The prior independent reviewers inspected these six captures and approved the
visual result for `38976fe0e26c8ea9715780fb1985254d15a88acc` — **agent review only**.
This packaging step is not a new independent review. The PR must preserve the
reviewed source identity, current independent review record and required hosted
verification before merge.
