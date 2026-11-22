# 📱 SPN-154 physical-phone check

**Status: not run; merge gate explicitly waived by the owner, chat 2026-11-22.**
The [SPN-154 acceptance decision](SPN-154.md#-physical-phone-acceptance-waiver)
accepts verified native desktop and emulated-phone evidence without claiming a
physical-phone pass or the cause of the original incident. This checklist remains
available for an optional later check. SPN-170 and SPN-163 waivers are unrelated.
The first temporary tunnel expired after a watchdog abort; obtain fresh verified
fixture links before using this checklist. Use the concrete build and exact source identity supplied in
[PR #301](https://github.com/mxbaylee/spinel/pull/301) and the handoff's build
manifest. A new controlled result does not identify the original phone incident.

## Known fixture

Use an ordinary signed-in Owner, online, with a modern editable Doc containing
exactly these two paragraphs and only **journal** bold:

```text
Phone journal
Second line
```

The native text is `Phone journal\rSecond line\r\n`. Use the supplied
[clipboard-source.png](evidence/SPN-154/clipboard-source.png): image/png,
80×60, RGB 23/201/151, 247 bytes, SHA-256
`3b5a98d5f358349c7e8e6cf77a4c4a3398c2530cfbc209b75da9668dca54e4c2`.
The OS/browser may re-encode clipboard bytes; this source hash is not a claim
about the phone's clipboard encoding.

## Five phone actions

Before starting, record source/build, date/time, physical phone model,
OS/browser versions, keyboard, browser-tab versus installed launch, and online
state. Keep the first result and screenshots before trying another action.

1. Open the seeded Doc as its Owner. Confirm **Saved / All changes saved.**
   A view-only or larger-screen notice means this is the wrong fixture.
2. Open the supplied PNG and use the phone's native **Copy image** action.
   Record the app and exact action; copying a link or filename is not this case.
3. Return, tap **Edit**, place the caret immediately before `P`, and **Paste once**.
   Expect one green image before the unchanged paragraphs, only `journal` bold,
   and the caret before the original text. Record any different result or error.
4. If native **Undo and Redo** are both available, use each once: remove the image
   without changing the text, then restore that same image. Otherwise record
   which control is unavailable and continue with the pasted state.
5. Wait for **Saved / All changes saved.**, return to files, then reopen the same
   Doc. Confirm the image renders and the complete text/bold survive. Retain
   the first-paste and reopened screenshots and every actual outcome.

Do not retry a failed paste into a pass or substitute a synthetic event,
emulator, link insertion or direct drawing. If copying or
pasting an image is unavailable, record that exact missing capability. Record
any flash, disappearing editor or navigation as observed; a flash alone does
not identify native-editor replacement or top-level browser navigation.

## Preparer setup

Use Node **26.13.0**, the matching source checkout and pinned dependencies, and
the supplied built `dist/` with its manifest/checksums. A frontend ZIP is not a
standalone server. The build manifest records the exact source and runtime
identity; verify it before the phone action. No database, credential or production
deployment is supplied by the build.

Follow the existing [own-phone setup](SPN-090-own-phone-findings.md#-how-the-run-was-set-up-to-repeat-it),
[local settings](../development.md#local-settings) and [first-admin setup](../setup.md).
Use a capable host and a private throwaway database. Normal workspace ownership
stays enabled. Start the existing free tunnel, for example:

```sh
cloudflared tunnel --url http://localhost:3000 --protocol http2
```

Use its exact HTTPS hostname, without a trailing slash. Set identical
`APP_ORIGIN` and absolute `DATABASE_PATH` for server and setup. A Linux example,
with the matching dependencies/build already present:

```sh
nvm use
export SPN154_PHONE_DIR="$(mktemp -d /tmp/spn154-phone.XXXXXX)"
export APP_ORIGIN='https://<tunnel-host>.trycloudflare.com'
export DATABASE_PATH="$SPN154_PHONE_DIR/spinel.sqlite"
export HOST=127.0.0.1 PORT=3000
node scripts/serial.ts node scripts/ci/doc-native-runtime/watchdog.ts \
  --application-window "$SPN154_PHONE_DIR/start-watchdog.json" npm start
```

In another terminal with those same origin/database settings, run `npm run setup`.
Claim the admin passkey privately, create an invite with **A new account**, and
accept it on the phone as the everyday Owner. Admin accounts cannot edit Docs.
A changed tunnel hostname requires a fresh throwaway database because passkeys
bind to the hostname.

Coordinate one workload and follow the repository's resource rules. The Linux
wrapper retains the existing 2 GiB process-tree limit and 450-second application
window; it is not a command for a non-Linux host. Preserve any startup/resource
failure and use the supported host procedure without bypassing ownership or
raising the acceptance budget. Stop task-owned processes after retaining results.
This direct-server observation does not establish supervised-recovery acceptance.

If phone inspection is already available, the preparer may retain the original
**Document canvas** node and `performance.timeOrigin`, then compare connection,
time origin and top-level navigation before the deliberate reopen. Otherwise
record those measurements as unavailable and report only the visible symptom.
The Owner does not need to build a diagnostics harness. No paid device execution
or change to the SPN-170 runtime flag, tag, label or manual input is part of this
check.
