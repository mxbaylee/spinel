# Developing Spinel

Use the Node version in `.nvmrc` (24.19.0). From a fresh checkout:

```sh
nvm use
npm ci
npm run dev
```

The Node server opens `http://127.0.0.1:3000` in your browser, serves a placeholder
React dashboard through Vite, and creates `data/spinel.sqlite` on first startup.
Vite updates the frontend as you edit; Node watch restarts the server on changes.
Use `npm run dev -- --no-open` to suppress the browser opening, and Ctrl+C to stop.
No database service, credentials or environment file is needed.

To check the production build locally:

```sh
npm run build
npm start
```

The same Node entry point serves `dist/` without starting Vite. Build before
starting; a missing build fails immediately. The server runs TypeScript directly
with Node's type stripping, so keep the source and production dependencies when
running it. Deployment packaging is SPN-029.

## Local settings

- `PORT`: HTTP port, default `3000`; `0` asks the OS for an available port.
- `HOST`: bind address, default `127.0.0.1`. Leave this at loopback while the app
  has no authentication; public deployment is out of scope for the scaffold.
- `DATABASE_PATH`: SQLite filename, default `data/spinel.sqlite` under the repo.
  Relative overrides resolve from the current working directory. Parent folders
  are created automatically. Database files and sidecars are ignored by Git.

`GET /api/health` verifies a database query and returns `{"status":"ok"}`. Unknown
API paths return JSON 404s; they never fall through to the dashboard. No document
or account endpoints exist yet. An empty database is intentional: domain tables
arrive with the tickets that use them. Startup preserves existing data.

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
production servers on ports 3100 and 3101 with databases in `test-results/`.
It checks rendering, mobile width, browser errors and same-origin API responses
in Chromium. It never reuses a running server or the everyday database.
On Linux, use `npx playwright install --with-deps chromium` for system libraries.

`npm run lint` checks repository TypeScript with Oxlint and formatting of the new
app, server, tests and root tool configs with Prettier. `npm run format` formats
that same scaffold; existing backlog and reference/design files keep their
formatting. All TypeScript, including existing scripts/reference code, extends
the root `tsconfig.json` and is checked by `npm run typecheck`.

CI requires **Backlog**, **Pull request**, **Lint**, **Typecheck**, **Unit tests**
and **Playwright smoke**. The owner must add the four new application checks to
the `main` ruleset; see [the process](todo/process.md#pull-requests-and-main).

## Architecture decisions

- TypeScript, React, Vite, Vitest, Node, Playwright and Prettier mirror
  circus-health. Server, frontend, tests, scripts and config use `.ts`/`.tsx`,
  never authored `.js`, `.mjs` or `.cjs`; Node-executed code uses erasable syntax.
  HTML/CSS and generated build assets are normal outputs. Owner, chat 2026-10-17.
- SQLite fits one process and one file on the 2 GB droplet. Owner, chat 2026-10-17.
  Express serves Vite middleware in development and built assets in production.
  `node:sqlite` avoids a native addon install; its API is a release candidate in Node 24.19.0
  and isolated in `server/database.ts`. WAL mode and foreign keys are enabled without resetting migration metadata. Decided
  2026-10-17 in [#2](https://github.com/mxbaylee/spinel/issues/2).
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
  chat 2026-10-17. Editors and SDK dependencies arrive in SPN-007.

These choices favour a small setup for the Operator, dependable storage and
rendering for the Owner, a consistent origin for the Collaborator, and an
explicit future access boundary for the Link guest. The placeholder contains no
private data. Operator accounts must not access documents, and Link guests must
not access the dashboard once those personas have working access paths.
