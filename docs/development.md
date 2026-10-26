# Developing Spinel

For the SPN-057/SPN-058 integration, `SPINEL_SYNC_SERVER=1` selects the
new server, native browser client and ephemeral presence; it defaults off. Use newly prepared test documents. Each backend
refuses documents already owned by the other, so changing the flag cannot create
a separate edit history. SPN-056 reviews the integrated path, and SPN-059 owns default activation and
retained-data conversion. See [the protocol and limits](collaboration.md#spinel-server-integration-flag).

Use the Node version in `.nvmrc` (26.12.1). From a fresh checkout:

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
production servers on ports 3100 and 3101, a disposable mobile HTTPS server
on port 3103, and flag-on native sync servers on ports 3104 and 3105, with databases in `test-results/`. Projects run sequentially to
avoid keeping several SDK server processes in memory. CI instead runs each
project on its own runner, splitting development and production in two with
`--shard`, and the **Playwright smoke** check passes only when every run and the
container smoke do.

`sync-development` and `sync-production` run `e2e/sync-client.spec.ts` with
`SPINEL_SYNC_SERVER=1`. They exercise actual native Sheet/Doc editing, offline
rebasing, an accepted write with a deliberately lost acknowledgment, visible-model
verification, drawing insertion and scoped Space guest presence. These projects
use independent disposable databases; the ordinary projects retain the default
legacy path. For a focused run, use
`SPINEL_E2E_PROJECT=sync-production npx playwright test --project=sync-production`.

The container smoke builds the actual Dockerfile, checks the production native
dependencies, serves the built sign-in page and JavaScript as the image's default
non-root user, and verifies database integrity and setup-record persistence after
container recreation. It uses disposable data and the deployment's resource and
filesystem constraints; it does not deploy or replace the host preflight.

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

## Reviewed dependency updates

[Dependabot configuration](../.github/dependabot.yml) proposes weekly updates on
Monday at 09:00 America/Los_Angeles for root npm workspaces, both Node Dockerfile
stages, Caddy in `deploy/compose.yaml`, and GitHub Actions. Existing Univer packages
are grouped separately for version and security updates. The updater changes
existing dependencies; it does not authorize adding Pro packages. Keep Docker
image digests and Actions commit SHAs immutable, with review of each replacement.
`SPINEL_IMAGE` remains the Operator's selected built artifact.

The [Node 26 update](implementation/dependency-node-26.md) keeps `.nvmrc`, both
Docker stages and the application engine declaration aligned. CI runs the actual
production image alongside the application suites; a Docker-only pin would not
prove the new runtime through host-based browser tests. Runtime and Node type
updates are validated in separate dependency PRs.

The literal `⬆️ Bump ` title prefix includes its trailing space. Dependency PRs
use the normal review and applicable CI gates. This configuration change also
requires full CI; neither it nor update PRs enable automatic merge or deployment.

Keep the existing registry configuration. npm version updates have a seven-day
cooldown; security updates are not delayed by that option. Both remain subject to
curation: a blocked or too-new version waits, with no retry through another
registry or tarball. No repository `.npmrc` or private registry is configured at
this change; the local registry probe returned `https://registry.npmjs.org/`.
That is not evidence that packages have passed an external curation service. If a
curated registry is introduced, configure Dependabot for that same registry
using its supported registry settings and secrets; do not copy developer tokens
or leave a public fallback that bypasses its policy.

After enabling on the default branch, inspect **Insights → Dependency graph →
Dependabot** and record actual update logs, failures, or no-update results. If a
real bump PR opens, record its generated title and **Pull request** check result.
Fix rejected configuration or access through the normal review process, never by
loosening curation or CI. Configuration validation and a representative title
probe do not prove hosted execution. The retained evidence checklist and source
review are in [SPN-100](implementation/SPN-100.md#verification-and-hosted-rollout).
Host patching and deployment remain outside this change; the prior live-server
routine was [retired](implementation/grooming-dependency-registration-2026-10-23.md#align-work-with-the-undeployed-product).

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

Keep Storybook's loopback development-server and origin restrictions enabled.
The [10.6 dependency decision](implementation/dependency-storybook-10.6.md)
records the core-before-adapter sequence and related esbuild security update.

The workflow builds once, then reviews desktop light, desktop dark, tablet,
phone light and phone dark in parallel. Every applicable PR retains full-catalog
rendering, story play/error checks and the existing native, keyboard, touch,
focus and shared-control assertions. Desktop light owns the once-only native
input proofs and icon/integration suite; tablet retains the intermediate 613 px
mouse checks. The stable **Review Storybook states and interactions** gate
requires every applicable partition before main deploys to Pages. Failed,
cancelled or missing results cannot pass as skipped work.

Routine PNG capture is opt-in: add **`visual-review`** to a PR, or set
**`capture_screenshots=true`** on a manual Storybook run. Add the label for changes
to layout, themes, fonts, icons or visible interaction states, including relevant
dependency updates. It requests evidence, not approval; the owner or explicitly
delegated reviewer still approves affected screens. An explicit capture request
also runs for a documentation-only PR. Without a capture request, code PRs and
main pushes retain rendering and interaction checks, semantic/JSON evidence and
failure screenshots while omitting routine PNGs. Ordinary documentation-only
PRs report the unchanged catalogue as not applicable. The separate
`storybook-preview` label still publishes an interactive review build.

The shared build keeps its ordinary `npm ci` and registry-audit invocation. The
viewport installs use `npm ci --no-audit` so duplicate advisory requests
cannot consume each review budget. Locked installation, integrity verification,
postinstall and all review coverage remain. This narrow response to repeated
five-minute installs is recorded in [decision #138](implementation/SPN-091.md#legacy-decision-138-avoid-duplicate-registry-audit-requests),
2026-10-22; a retained audit invocation is not evidence that an unavailable
registry completed a security audit.

With captures enabled, download `design-review-desktop-light`,
`design-review-desktop-dark`, `design-review-tablet`, `design-review-mobile-light`
and `design-review-mobile-dark` for galleries. Without routine capture, the
corresponding `storybook-check-*` artifacts retain verification and failure
evidence. `storybook-review` is the shared interactive build. The once-only icon
suite produces `entity-icon-screenshots` or `entity-icon-checks` respectively.
After building locally when local workloads are permitted, `npm run screenshots`
still captures the full review. Add `--no-screenshots` to keep the checks without
routine PNGs. `--viewport desktop|tablet|mobile` selects one viewport;
`--theme light|dark` partitions desktop or mobile. Default `all` retains both
themes. Fixed-light auxiliary journeys run once in the light job. Only manual CI
runs can narrow story IDs; PRs always review the full catalog. See the
[capture and partition decision](implementation/backlog-workflow.md#on-demand-storybook-captures).

CI requires **Backlog**, **Pull request**, **Lint**, **Typecheck**, **Unit tests**,
**Lib tests** and **Playwright smoke**. These seven checks are required by the active default-branch ruleset;
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
  [Decision #68](implementation/SPN-025.md#legacy-decision-68-single-sqlite-runtime-and-consistent-copies), 2026-10-18,
  supersedes the original driver choice in [#2](implementation/SPN-001.md#legacy-decision-2-one-process-and-initial-sqlite-adapter).
- Startup upgrades the workspace schema for the [Space foundation](design/spaces.md#implemented-foundation)
  before the collaboration SDK opens its database connection. The migration
  preserves existing item IDs, native foreign keys, indexes and cleanup triggers;
  incomplete or unrecognized schemas fail startup instead of being guessed or
  partially upgraded. Native children remain inaccessible through ordinary item lookup.
  [Decision #135](implementation/SPN-078.md#legacy-decision-135-durable-space-identity-and-scope), 2026-10-21;
  [implementation and verification](implementation/SPN-078.md).
- Spaces are enabled by default at `/spaces`; `/review/spaces` remains an alias
  from SPN-091. The legacy `SPINEL_SPACE_REVIEW=0` option (or
  `createApp({ spaceReview: false })`) explicitly disables every Space boundary
  while preserving its data. Native access carries exactly one current account,
  root guest, MCP or private history credential with the exact root and stable
  child; asynchronous work rechecks access and live generation. Only outer-file
  metadata/lifecycle composes roots with ordinary files. Images, Formulas, MCP,
  existing exports, account history and selected-child offline preparation reuse
  those scoped services. The option gives Operators no document privileges.
  The original safe sequencing is [decision #137](implementation/SPN-091.md#legacy-decision-137-default-off-space-review-stage);
  the completed boundary is [decision #143](implementation/SPN-092.md#legacy-decision-143-exact-space-capabilities-across-integrations)
  and the [SPN-092 implementation contract](implementation/SPN-092.md).
- React and React DOM are pinned together to 19.3.1, with React and React DOM
  types at 19.3.0. The installed Univer 1.1.0, Base UI 1.9.0 and Storybook 10.6.2
  peer ranges allow React 19. The presence workspace follows the tested runtime;
  DOM ref types explicitly include their unmounted null state, and a guarded
  open-source Univer UI repair ignores resize callbacks after that ref detaches.
  Keep these four packages coordinated when upgrading and verify native editor lifecycle, portals,
  focus and save/access behavior. The [React 19 upgrade record](implementation/dependency-react-19.md)
  supersedes the initial [React 18 scaffold baseline](implementation/SPN-001.md#legacy-decision-1-react-version).
- Oxlint works alongside the existing TypeScript 7 compiler; typescript-eslint
  8.71.2 requires TypeScript below 6.1. Prettier handles scaffold formatting.
  Decided 2026-10-17 in [#3](implementation/SPN-001.md#legacy-decision-3-compiler-compatible-linting).
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
