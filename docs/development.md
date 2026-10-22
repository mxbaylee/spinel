# Developing Spinel

Use the Node version in `.nvmrc` (24.19.0). From a fresh checkout:

```sh
nvm use
npm ci
npm run dev
```

The Node server opens `http://localhost:3000` in your browser, serves passkey sign-in and a protected
React dashboard with private folders and a spreadsheet editor through Vite, and creates `data/spinel.sqlite` on first startup.
Vite updates the frontend as you edit; Node watch restarts the server on changes.
Use `npm run dev -- --no-open` to suppress the browser opening, and Ctrl+C to stop.
No database service or environment file is needed. An empty database has no accounts;
run `npm run setup` in another terminal to [claim the first admin](setup.md).
The [isolated passkey check](authentication.md#manual-provider-check) still provides
a disposable everyday-account fixture. Use [Admin invites](invitations.md) for
normal account creation.

To check the production build locally:

```sh
npm run build
npm start
```

The same Node entry point serves `dist/` without starting Vite. Build before
starting; a missing build fails immediately. The server runs TypeScript directly
with Node's type stripping, so keep the source and production dependencies when
running it. Deployment packaging was delivered by SPN-029.

## Deployment stage

Spinel is **pre-production** until SPN-038 launches `https://spinel.baylee.dev`.
That is the last launch prerequisite; optional CSV import (SPN-093) and document/format
plugins (SPN-094) come afterward. The private test host was retired. References to a production
build, production Playwright project or current production component describe
the application runtime, not an already-live production deployment.

SQLite is today's database, not a permanent product requirement. Removing Univer
Pro is a useful point to reconsider one coherent storage setup, including a
managed database if it simplifies operation. Compare actual access/transaction
semantics, recovery, resource use and ongoing cost before selecting it. There is
no assumed live-production dataset or required zero-downtime migration at this
stage. Preserve any data deliberately selected for retention; disposable fixtures
can be reseeded. Do not build several backend adapters just for possible future
choices. Owner, chat 2026-10-21.

Browser offline storage remains a separate concern: changing the server database
cannot make browser-local pending edits durable on the server before they are
uploaded and acknowledged. See [offline storage](offline.md) and
[recovery requirements](backups.md#recovery-requirements-and-hosting-options).

## Local settings

- `PORT`: HTTP port, default `3000`; `0` asks the OS for an available port.
- `HOST`: bind address, default `127.0.0.1`. Keep this at loopback; deployment must expose HTTPS through the private proxy (SPN-029).
- `APP_ORIGIN`: exact browser origin, default `http://localhost:PORT`. Production
  must set its HTTPS hostname, with no trailing slash. Passkeys are bound to that
  hostname; an IP address is rejected. Port `0` is for startup tests only.
- `DATABASE_PATH`: SQLite filename, default `data/spinel.sqlite` under the repo.
  Relative overrides resolve from the current working directory. Parent folders
  are created automatically. Database files and sidecars are ignored by Git.

`GET /api/health` requires a signed-in session, verifies a database query and
returns `{"status":"ok"}`. Signed-out APIs return 401 with sign-in guidance;
unknown signed-in APIs return JSON 404s. `/sign-in` is the public startup probe.
Authentication tables are created without resetting existing data or migration
metadata. See [authentication](authentication.md) for sessions and access rules.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run e2e
npm run backlog:check
```

`npm test` runs the existing Node backlog tests and Vitest server tests.
`npm run e2e` builds the frontend, then Playwright starts isolated development and
production servers on ports 3100 and 3101, then a disposable mobile HTTPS server
on port 3103, with databases in `test-results/`. Projects run sequentially to
avoid keeping several SDK server processes in memory. CI instead runs each
project on its own runner, splitting development and production in two with
`--shard`, and the **Playwright smoke** check passes only when every run does.
To repeat one run locally, build first, then use
`SPINEL_E2E_PROJECT=production npx playwright test --project=production --shard=1/2`.
The HTTPS fixture uses a
temporary test certificate accepted only by its isolated browser; see
[mobile verification](mobile.md#verification-and-deployment).
It checks access boundaries, mobile width, real WebAuthn verification with two
virtual authenticators, session persistence, cancellation and revocation in Chromium. It never reuses a running server or the everyday database.
On Linux, use `npx playwright install --with-deps chromium` for system libraries.

`npm run lint` checks repository TypeScript with Oxlint and formatting of the new
app, server, tests and root tool configs with Prettier. `npm run format` formats
that same scaffold; existing backlog and reference/design files keep their
formatting. All TypeScript, including existing scripts/reference code, extends
the root `tsconfig.json` and is checked by `npm run typecheck`.

## Component catalogue

```sh
npm run storybook        # http://localhost:6006
npm run build-storybook  # static build in storybook-static/ (gitignored)
```

Storybook renders the shell components from `src/ui/` and `web/` with mocked
API responses, in both themes and at Phone, Tablet and Desktop widths. Stories
are `*.stories.tsx` beside their component and are typechecked and linted with
everything else. The **Storybook** workflow builds it on every pull request and
publishes `main` to <https://mxbaylee.github.io/spinel/> (Owner, chat
2026-10-19). It isn't a required branch-protection check. What a story must cover
is in the [design playbook](design/README.md#storybook); use the
[manual design review runbook](design/review-runbook.md) when a design changes.

The workflow builds once, then runs desktop, tablet and mobile reviews in
parallel, each with a 15-minute timeout. Desktop retains light/dark and native
editor interaction proofs; mobile retains light/dark; tablet retains its light
captures and the intermediate 613 px mouse interaction checks. The icon suite
runs once on desktop. The stable **Review Storybook states and interactions**
gate requires every viewport to pass before Pages can deploy. Explicitly
classified documentation-only PRs skip the captures; failed or missing results
cannot pass as documentation-only.

Download `design-review-desktop`, `design-review-tablet` and
`design-review-mobile` for self-contained galleries. `storybook-review` is the
shared interactive build, and `entity-icon-screenshots` is the icon gallery.
After building locally, `npm run screenshots` runs the full review;
`npm run screenshots -- --viewport mobile <story IDs>` runs one viewport and
optional focused stories. Only manual CI runs can narrow story IDs; PRs always
review the full catalog.

CI requires **Backlog**, **Pull request**, **Lint**, **Typecheck**, **Unit tests**
and **Playwright smoke**. These are required by the active default-branch ruleset;
see [the process](todo/process.md#pull-requests-and-main).

## Architecture decisions

- TypeScript, React, Vite, Vitest, Node, Playwright and Prettier mirror
  circus-health. Server, frontend, tests, scripts and config use `.ts`/`.tsx`,
  never authored `.js`, `.mjs` or `.cjs`; Node-executed code uses erasable syntax.
  HTML/CSS and generated build assets are normal outputs. Owner, chat 2026-10-17.
- SQLite fits one process and one file on the 2 GB droplet. Owner, chat 2026-10-17.
  Express serves Vite middleware in development and built assets in production.
  Application connections use the same pinned `libsql` runtime as the public SDK
  adapter, behind `server/database.ts`. Mixing it with `node:sqlite` in one process
  failed repeated reopen tests and risks independent SQLite lock registries.
  WAL mode and foreign keys remain enabled without resetting migration metadata.
  [Decision #68](https://github.com/mxbaylee/spinel/issues/68), 2026-10-18,
  supersedes the original driver choice in [#2](https://github.com/mxbaylee/spinel/issues/2).
- Startup upgrades the workspace schema for the [Space foundation](design/spaces.md#implemented-foundation)
  before the collaboration SDK opens its database connection. The migration
  preserves existing item IDs, native foreign keys, indexes and cleanup triggers;
  incomplete or unrecognized schemas fail startup instead of being guessed or
  partially upgraded. Public Space creation and child capabilities remain closed.
  [Decision #135](https://github.com/mxbaylee/spinel/issues/135), 2026-10-21;
  [implementation and verification](implementation/SPN-078.md).
- SPN-091 account review is explicitly enabled with `SPINEL_SPACE_REVIEW=1`
  (`createApp({ spaceReview: true })` in tests). The default is off. The review
  entry is `/review/spaces`; its tree/recovery API and native protocol use the
  same gate and current everyday-account authorization. Native access carries
  the exact Space and stable child plus the current session through reads,
  sockets and after-await checks; ordinary item, guest and MCP paths stay closed.
  Images, formulas, public history, exports and offline preparation remain
  unavailable for this slice; automatic Space history capture is explicitly
  deferred, preserving existing checkpoints. SPN-092 owns those integrations
  and ordinary activation. This flag gives Operators no document privileges.
  [Decision #137](https://github.com/mxbaylee/spinel/issues/137), 2026-10-21;
  [implementation contract](implementation/SPN-091.md).
- React and React DOM are pinned to 18.3.1. On 2026-10-17, published
  `@univerjs/ui@1.1.0` and `@univerjs/design@1.1.0` peer dependencies support
  React 16–19; [Univer's UI package](https://github.com/dream-num/univer/blob/dev/packages/ui/package.json)
  uses 18.3.1 in development. Matching that baseline and the existing React 18
  types reduces editor integration work. Decided 2026-10-17 in
  [#1](https://github.com/mxbaylee/spinel/issues/1). Recheck when adding editors.
- Oxlint works alongside the existing TypeScript 7 compiler; typescript-eslint
  8.71.2 requires TypeScript below 6.1. Prettier handles scaffold formatting.
  Decided 2026-10-17 in [#3](https://github.com/mxbaylee/spinel/issues/3).
- Build editors on the open-source Univer SDK (`@univerjs/*`, Apache-2.0).
  Univer Workspace is reference material only, never forked or deployed.
  Copied code must preserve license headers, note modifications and appear in
  `THIRD-PARTY-NOTICES.md`. No Univer code is copied by the scaffold. Owner,
  chat 2026-10-17. The first [spreadsheet editor](spreadsheets.md) pins the
  open-source preset and core packages at 1.1.0.

These choices favour a small setup for the Operator, dependable storage and
rendering for the Owner, a consistent origin for the Collaborator, and an
explicit future access boundary for the Link guest. The [folder API](folders.md) enforces ownership for every item. Operator accounts
cannot access documents, and Link guests cannot access the dashboard.
