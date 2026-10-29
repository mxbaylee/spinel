# SPN-111 — maintenance views

| Set | What it shows |
| --- | --- |
| [application/](application/README.md) | The approved gallery: actual production captures on `fa4f3c4`, reviewed by both independent nonimplementing reviewers. **Agent review only.** |
| [dismissal/](dismissal/README.md) | Production-component Storybook captures of the dismissal states, with provenance. |
| [dismissal-acceptance.md](dismissal-acceptance.md) | The dismissal behavior that was accepted. |

`application/` comes from `e2e/maintenance.spec.ts` running the actual
production application against the independent Linux recovery supervisor.
`dismissal/` comes from Storybook rendering the production components; its
README records how. In both, accounts, passkeys and document content are
synthetic; no capture contains a live account or recovery token.

Set `SPINEL_MAINTENANCE_CAPTURE=1` when running the production maintenance
acceptance to refresh `application/`. Without it, screenshots stay in the
test's ordinary output directory. Storybook separately covers unavailable,
draining, expired/lost authority, failed, missed/cancelled notice, cancelling
a notice while paused, and invalid-time states.

Superseded capture sets are not kept here. The original pre-dismissal set and
the `7a7072d` gallery remain at
[`a6ac90fbbc6f93e2e923e56230eaa5ff3bf24b1c`](https://github.com/mxbaylee/spinel/tree/a6ac90fbbc6f93e2e923e56230eaa5ff3bf24b1c/docs/design/review/spn-111).
