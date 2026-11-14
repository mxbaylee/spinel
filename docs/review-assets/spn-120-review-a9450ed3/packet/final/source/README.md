# 💎 Spinel

A private, invite-only workspace for spreadsheets and documents, built on
the open-source [Univer](https://github.com/dream-num/univer) SDK. Spinel is
meant for a handful of people on one small self-hosted server.

Passkey sign-in protects private folders and Sheet and Doc editors, backed by SQLite.
[Claim the first admin](docs/setup.md) with `npm run setup`; then [invite your everyday account](docs/invitations.md) from Admin.
See [spreadsheets](docs/spreadsheets.md) and [documents](docs/documents.md) for editing
and autosave, [sharing](docs/sharing.md) for account access, guest links and personal
filing, [search](docs/search.md) for metadata discovery and filters, and [files](docs/files.md) for native import/export and PDF printing.
See [authentication](docs/authentication.md) for the isolated passkey check.
See [mobile use](docs/mobile.md) for phone installation, Sheet touch controls and offline behavior.

Use Node from `.nvmrc`, then run:

```sh
npm ci
npm run dev
```

The app opens at `http://localhost:3000` and creates `data/spinel.sqlite`.
See [development](docs/development.md) for builds, checks and local settings,
and [process.md](docs/todo/process.md) for how tickets are reviewed and landed.
To run tickets continuously, use the [backlog runbook](docs/run-backlog.md):
“Read `docs/run-backlog.md` and start working.”

Licensed under [Apache-2.0](LICENSE). Third-party code is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Private folders and empty document creation are described in [Folders](docs/folders.md).
