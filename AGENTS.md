# Spinel — instructions for agents

Spinel is a private, invite-only workspace for Sheets, Docs and Slides, built on
the open-source [Univer](https://github.com/dream-num/univer) SDK, for about two
people at a time. The product has no AI features.

## Before any work

Read [docs/todo/process.md](docs/todo/process.md). It covers how tickets are
written, picked, split, reviewed and landed, how decisions are recorded, and
when grooming happens. The Top 5 in [docs/todo/readme.md](docs/todo/readme.md)
says what is next.

## Rules that are easy to miss

- **Never edit `docs/todo/readme.md` by hand.** Run `npm run backlog:index`.
- **Never reuse a ticket ID.** Use `npm run backlog:new`.
- **One ticket per PR**, titled `<ticket emoji> SPN-NNN <ticket title>`. Squash
  merge only.
- **Weigh every persona** in [docs/product/personas.md](docs/product/personas.md)
  when deciding anything, and log the decision as described in process.md.
- **TypeScript only.** Server, frontend, tests, scripts and config are `.ts` or
  `.tsx`, never `.js`, `.mjs` or `.cjs`. Node runs scripts directly, so use only
  syntax it can strip (no enums or namespaces). Owner, chat 2026-10-17.
- **UI changes follow [docs/design/](docs/design/README.md).** A ticket that
  needs a pattern the playbook doesn't cover adds it there in its own PR first,
  and every new component or state gets a Storybook story. Owner, chat
  2026-10-19 (SPN-046).
- **Univer Pro packages** (`@univerjs-pro/*`) are closed source under Univer's
  terms. Use them through their public API and docs only: don't decompile,
  deobfuscate or patch them, and don't work around license checks or
  watermarks.
- **Code copied from Univer Workspace** or any other Apache-2.0 project keeps its
  license header, gets a note saying it was changed, and is listed in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- Run `npm run typecheck`, `npm test` and `npm run backlog:check` before pushing.
  Exception: when the memory watchdog prevents safe local testing, run local
  typecheck, lint and backlog checks, then push a draft PR for full unit/browser
  validation in CI. Keep it draft while unverified; all six CI gates and independent
  review >=95 with no blockers remain required before merge. Owner, chat
  2026-10-18; [decision #52](https://github.com/mxbaylee/spinel/issues/52).
