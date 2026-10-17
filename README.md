# 💎 Spinel

A private, invite-only workspace for spreadsheets, documents and slides, built on
the open-source [Univer](https://github.com/dream-num/univer) SDK. Spinel is
meant for a handful of people on one small self-hosted server.

The scaffold runs a placeholder dashboard and a Node server backed by SQLite.
Sign-in and editors are still on the [backlog](docs/todo/readme.md).

Use Node from `.nvmrc`, then run:

```sh
npm ci
npm run dev
```

The app opens at `http://127.0.0.1:3000` and creates `data/spinel.sqlite`.
See [development](docs/development.md) for builds, checks and local settings,
and [process.md](docs/todo/process.md) for how tickets are reviewed and landed.

Licensed under [Apache-2.0](LICENSE). Third-party code is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
