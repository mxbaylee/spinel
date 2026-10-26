# Spinel — instructions for agents

Spinel is a private, invite-only workspace for Sheets and Docs, built on
the open-source [Univer](https://github.com/dream-num/univer) SDK, for about two
people at a time. The product has no AI features.

Spinel is pre-production until SPN-038 launches `spinel.baylee.dev`; that is the
last launch prerequisite, with optional CSV import (SPN-093) and document/format plugins
(SPN-094) after launch. SQLite is the current implementation, not a permanent
storage constraint. Reconsider it before launch without inventing a live-data
migration requirement. See [development](docs/development.md#deployment-stage).
Owner, chat 2026-10-21.

## Before any work

Read [docs/todo/process.md](docs/todo/process.md). It covers how tickets are
written, picked, split, reviewed and landed, how decisions are recorded, and
when grooming happens. The first ticket in [docs/todo/readme.md](docs/todo/readme.md)
that isn't waiting on another is next.

## Rules that are easy to miss

- **Never edit `docs/todo/readme.md` by hand.** Run `npm run backlog:index`.
- **Never reuse a ticket ID.** Use `npm run backlog:new`.
- **One ticket per PR**, titled `<ticket emoji> SPN-NNN <ticket title>`. Squash
  merge only.
- **Weigh every persona** in [docs/product/personas.md](docs/product/personas.md)
  when deciding anything, and log the decision as described in process.md.
- **Decisions live in `docs/implementation/SPN-NNN.md`**, beside implementation notes, following [the record convention](docs/implementation/README.md). Link them from ticket Rules; [SPN-096's inventory](docs/implementation/SPN-096.md) maps legacy issues to canonical records with original provenance. Owner, chat 2026-10-22.
- **TypeScript only.** Server, frontend, tests, scripts and config are `.ts` or
  `.tsx`, never `.js`, `.mjs` or `.cjs`. Node runs scripts directly, so use only
  syntax it can strip (no enums or namespaces). Owner, chat 2026-10-17.
- **UI changes follow [docs/design/](docs/design/README.md).** A ticket that
  needs a pattern the playbook doesn't cover adds it there in its own PR first,
  and every new component or state gets a Storybook story. Owner, chat
  2026-10-19 (SPN-046).
- **UI PRs request screenshots with `visual-review`** and carry current light,
  dark and phone evidence for affected screens. Approval comes from the owner
  or a reviewer the owner explicitly delegates for that run. Other PRs keep
  Storybook rendering and interaction checks without routine PNG capture;
  failure diagnostics remain. Work the next ticket while approval waits.
  Owner, chat 2026-10-19 and 2026-10-25;
  [capture policy](docs/implementation/backlog-workflow.md#on-demand-storybook-captures).
- **Univer Pro packages** (`@univerjs-pro/*`) are closed source under Univer's
  terms. Use them through their public API and docs only: don't decompile,
  deobfuscate or patch them, and don't work around license checks or
  watermarks. Spinel is moving off Pro so nothing is watermarked: add no new
  `@univerjs-pro` packages; SPN-075 removed printing and SPN-059 removes the rest. Owner, chat
  2026-10-19.
- **Code that replaces a Univer package lives in `lib/<name>/`**, so it could be
  published on its own later without extracting it: its own `package.json`
  (private until published), README and tests, one public `index.ts`, and no
  imports from Spinel's `src/`, `web/` or `server/`. Spinel imports it by package
  name. The first ticket to add one sets up the `lib/*` npm workspace and adds
  `lib` to typecheck, lint, format and test runs, and to both Dockerfile stages.
  The build stage copies each lib's `package.json` by its own path before
  `npm ci`, one line per lib, since a `COPY` glob flattens directories. Owner,
  chat 2026-10-19; reworded 2026-10-22.
- **Code copied from Univer Workspace** or any other Apache-2.0 project keeps its
  license header, gets a note saying it was changed, and is listed in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- **CI may be the default for validation**, including typecheck, lint, backlog,
  unit and browser checks. Draft pushes do not require local checks to pass first.
  Keep unverified work draft; all seven CI gates, independent review >=95 with no
  blockers and required visual approval remain merge requirements. Local workloads
  still obey the memory watchdog. Owner, chat 2026-10-23;
  [decision](docs/implementation/backlog-workflow.md#ci-as-the-default-validation-environment).
  The seventh, Lib tests, runs `lib/` on its own and passes at once when nothing it
  tests changed. Owner, chat 2026-10-22.
