# 💎 Spinel

A private, invite-only workspace for spreadsheets, documents and slides, built on
the open-source [Univer](https://github.com/dream-num/univer) SDK. Spinel is
meant for a handful of people on one small self-hosted server.

Passkey sign-in protects a placeholder dashboard and a Node server backed by SQLite.
Account setup and editors are still on the [backlog](docs/todo/readme.md).
See [authentication](docs/authentication.md) for the isolated passkey check.

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
