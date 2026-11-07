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
- **📝 Use more meaningful emojis in documentation.** New and substantively
  updated docs should include relevant emoji cues in headings, callouts or
  checklists to make them easier to scan. Keep the words clear without the emoji;
  avoid decorating every line. Preserve existing ticket identities, generated
  index conventions and linked heading anchors. Owner, chat 2026-11-03;
  [documentation guidance](docs/todo/process.md#documentation-style).
- **One ticket per PR**, titled `<ticket emoji> SPN-NNN <ticket title>`. Squash
  merge only.
- **Size the complete outcome before building.** Include integration, authority,
  persistence, native/platform investigation and verification; record early scope
  checkpoints. Splits retain every remaining requirement and its estimate, so a
  closed parent never hides larger follow-ups. [Scope accounting](docs/implementation/grooming-2026-10-29.md#scope-growth-and-outcome-accounting).
- **Final evidence belongs in the PR description or maintained code.** Preserve
  exact source/check/review identities, measurements, useful visuals and failure
  dispositions; comments and expiring artifacts only supplement that record.
  After merge, preserve unique work and delete every obsolete ticket-created
  implementation/review/integration/evidence branch after rechecking its head
  and active PR ownership. Record access-blocked cleanup explicitly. Owner, chat
  2026-10-29; [evidence and cleanup](docs/implementation/grooming-2026-10-29.md#evidence-and-branch-completion).
- **Weigh every persona** in [docs/product/personas.md](docs/product/personas.md)
  when deciding anything, and log the decision as described in process.md.
- **Decisions live in `docs/implementation/SPN-NNN.md`**, beside implementation notes, following [the record convention](docs/implementation/README.md). Link them from ticket Rules; [SPN-096's inventory](docs/implementation/SPN-096.md) maps legacy issues to canonical records with original provenance. Owner, chat 2026-10-22.
- **TypeScript only.** Server, frontend, tests, scripts and config are `.ts` or
  `.tsx`, never `.js`, `.mjs` or `.cjs`. Node runs scripts directly, so use only
  syntax it can strip (no enums or namespaces). Owner, chat 2026-10-17.
- **All new and in-progress work follows [sustainable testing](docs/testing.md).** Name the regression
  contract, use the lowest meaningful layer, reuse deterministic fixtures and
  assign each environment a distinct purpose. Keep source/shared dependencies
  in the CI plan and prove selected missing/failed work cannot pass. Apply this
  in the ticket's Verify section, progress checkpoints and PR evidence. Repair
  test weaknesses introduced by the ticket before landing; separate cleanup
  tickets cannot replace its acceptance. Owner, chat 2026-11-01 (SPN-115).
- **UI changes follow [docs/design/](docs/design/README.md).** A ticket that
  needs a pattern the playbook doesn't cover adds it there in its own PR first,
  and every new component or state gets a Storybook story. Owner, chat
  2026-10-19 (SPN-046).
- **Agents decide using all four personas; human sign-off is not required.**
  Record decisions and their tradeoffs. UI PRs use `visual-review` and embed all
  proposed designs plus actual current light, dark and phone screenshots in the
  PR body/conversation. An independent nonimplementing subagent inspects them
  against [the design playbook and theme](docs/design/README.md), records findings
  and approves the visual result on the reviewed commit. Disclose **agent review
  only**. CI artifact links supplement the PR's visible evidence. Other PRs keep
  rendering/interaction checks and failure diagnostics without routine captures.
  Owner, chat 2026-10-26; [standing delegation](docs/implementation/grooming-2026-10-26.md#agent-decisions-and-visual-review).
- **Publishing useful images on PRs is already authorized.** Attach relevant
  screenshots/designs or store them as durable, commit-pinned repository assets,
  including on public PRs, without asking for separate publication permission.
  Choose useful images covering the proposed designs, changed states and required
  light/dark/phone views; omit redundant captures. Independent visual review and
  accurate source/theme/viewport captions still apply. Owner, chat 2026-10-26;
  [standing image permission](docs/implementation/grooming-2026-10-26.md#standing-permission-to-publish-pr-images).
- **Univer Pro packages** (`@univerjs-pro/*`) are closed source under Univer's
  terms. Use them through their public API and docs only: don't decompile,
  deobfuscate or patch them, and don't work around license checks or
  watermarks. Spinel is moving off Pro so nothing is watermarked: add no new
  `@univerjs-pro` packages. SPN-075 and SPN-059 replaced printing and collaboration;
  `npm run dependencies:check` enforces the root/workspace manifest and lockfile
  boundary in required CI. The separately installed pre-cutover checkout is only
  for explicit offline retained-data export. Owner, chat 2026-10-19 and 2026-10-26.
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
- **Review locally before pushing.** Run the relevant feasible local checks,
  commit the complete candidate, and obtain two independent nonimplementing
  reviews, each **above 95/100 on that exact commit**, before a validation push
  or repair push intended to run CI. Fix findings and revalidate each new head.
  Draft checkpoint pushes may save unfinished work remotely with triggered CI
  deliberately cancelled; record missing checks/grades and verify cancellation.
  Coordinate agents' validation runs and preserve file-based job selection.
  Hosted-only or resource-blocked
  acceptance stays explicitly pending; a pre-push grade is not a CI pass.
  All seven current-head CI gates, no unresolved blockers and required visual
  approval remain merge requirements. Local workloads obey the memory watchdog;
  this does not require duplicating the full hosted matrix on the Mac. Owner,
  chat 2026-11-02–03; [ordering and evidence](docs/implementation/grooming-2026-11-02.md#review-before-push).
  Run this as a review–repair loop: reviewers list every step to 100, repair, recommit and
  review again until both exceed 95. Owner, chat 2026-11-06;
  [decision](docs/implementation/backlog-workflow.md#reviewrepair-loop-before-a-validation-push).
  The seventh, Lib tests, runs `lib/` on its own and passes at once when nothing it
  tests changed. Owner, chat 2026-10-22.
