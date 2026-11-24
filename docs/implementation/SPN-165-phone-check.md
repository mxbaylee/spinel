# 📱 SPN-165 phone editing acceptance

## 🎯 Current UI acceptance contract

Owner retargeted SPN-165 on 2026-11-23 to stable, obvious phone Sheet editing.
The historical blank formula value was not reproduced in the latest run; the
formula-only before/after checklist below is retained as history and is no longer
required. See the [scope decision](SPN-165.md#-retarget-to-stable-phone-sheet-editing).

Prepare a fresh exact-candidate fixture and verify its source/build, worker and
invitation before requesting device actions. All earlier invitations have expired.
The old diagnostic button must not cover the cell editor or any required action;
prefer an unobstructed production UI for this acceptance. Record Pixel model,
OS/Chrome version, installed-app mode, source/runtime and first failures.

After implementation, the bounded physical check must establish:

1. With the keyboard closed, select a literal cell and a formula cell. The bottom
   bar stays visible with the selected reference, exact text/formula and labeled
   pen edit action. Selection alone leaves the keyboard closed.
2. Open editing, type, dismiss/reopen the keyboard, commit and cancel. The editor
   stays above the keyboard without repeated jumps or obscured text/actions;
   draft, focus and selection remain intact until the chosen commit/cancel action.
3. Commit an unrelated-cell edit offline in a prepared copy, return to files,
   reconnect and reopen. Verify exact saved text/formula, unchanged other cells
   and one accepted edit, with server/device evidence collected by the agent.

Use the existing native/browser suites for independent access and writer checks;
do not turn this into a blanket physical-device matrix. Actual light/dark/390px
design review remains separate from real keyboard acceptance. The candidate UI
is implemented locally; browser and component evidence is recorded in the
[implementation checkpoint](SPN-165.md#-mobile-editor-implementation-checkpoint).
It has **not passed this physical checklist**. While the owner is away, prepare
and verify the final fixture without opening an invitation window that would
expire before use. Start a fresh bounded window only when the phone is available.

### 🛠️ Current UI fixture restart

The unobstructed UI build is source `d27babb5773e722b76f6721262df76f35e2ac30c`,
runtime `b91e7826b0926d5e`. Its verified private archive, source/output manifest
and preflight are linked from [the UI evidence summary](evidence/SPN-165/ui-summary.json).
The final reviewed candidate must retain the same runtime source hashes; rebuild
and revalidate if it does not. The archive contains the current UI launcher,
server, bundle, watchdog and identity file. It preserves synthetic credentials
privately; do not publish them or the preflight invitation.

From the repository, use a **new** directory suffix when the phone is available:

```bash
PATH=/Users/mxbaylee/.nvm/versions/node/v26.13.0/bin:$PATH \
SPINEL_PHONE_RUN=/private/tmp/spn165/phone-ui-new-window \
node scripts/serial.ts node /private/tmp/spn165/guard.ts phone-ui-new-window \
node --max-old-space-size=128 /private/tmp/spn165/phone-ui-window.ts
```

The launcher verifies all 1,290 source hashes and 53 output hashes before
starting; it verifies the public runtime, service worker and fresh invitation
before writing `ready.json`. Check that file privately before sharing only the
new invitation. It stops its own app/tunnel within 445 seconds. Reopen the fresh
fixture in a local browser and verify the selected-cell bar and native input
before requesting the three physical steps above. The successful preflight
window has already stopped and contains **zero physical observations**.

After the physical run, retain the first visible result and exact device/browser
identity, read the synthetic server state/revision and accepted-write IDs, then
archive/hash the run and verify owned processes stopped. Any failure remains a
blocker to merge until diagnosed; do not retry edits or infer OS keyboard behavior
from the synthetic viewport captures.

## 🗃️ Historical formula baseline instructions

The following records the prior fixture and investigation, not current UI
acceptance or an instruction to restart the obsolete formula-only handoff.

## 🔒 Exact disposable baseline

Production source: `cc9e9fd2222b12d87f0213e4d481409feb195ace`; observation runtime
`c2d1fcc9075a4fd4`, Node 26.13.0, Univer 1.3.1. The diagnostic build adds a
read-only **Record formula state** button. No formula calculation, sync, retry,
access or persistence behavior is repaired. This is a new throwaway account and
Sheet, not the owner's original file. Preserve the original installation/data.

The server seeds **SPN-165 SUM check** with A1:A4 = 10, 15, 20, 26 and
B5 = `=SUM(A:A)`, without a calculated cache. Chromium desktop visibly showed 71. The original historical offline edit is unknown; C1 below is a controlled
new edit that leaves the original inputs/formula unchanged.

## ✅ Required baseline actions

Use the fresh verified invitation supplied in the chat. A tunnel/invitation is
temporary; after its window closes, request a fresh window rather than reusing
an expired link. The agent verifies build/invitation readiness before handoff.

1. On the Pixel, open the invitation in Chrome and create the disposable test
   passkey. Install this test origin, launch its icon, and close its Chrome tab
   so there is only one test writer. Report the current Chrome version.
2. Open **SPN-165 SUM check**, note B5, then tap **Record formula state**.
   Wait for **Formula state recorded**. This is online/unprepared observation.
3. Through **Document actions → Available offline on this device**, wait for
   availability confirmation and tap **Done**. Return to files and reopen the
   Sheet while still online. Note B5 and tap **Record formula state** again.
4. Enable airplane mode and turn Wi-Fi off. Enter **phone edit** in C1, commit
   it, and wait for **Saved on this device — waiting to sync**. Note B5; return
   to files. Reconnect while staying on the list, then reopen after sync.
   Confirm C1 and A1:A4, note B5, and tap **Record formula state** again.
5. Reply with the B5 observations and whether all three reports were recorded.
   If an action fails or the value is blank, preserve that first result; do not
   repeatedly reload or re-enter the formula to turn the run green.

The report button reads current native state and IndexedDB through read-only
APIs; it does not force calculation or submit workbook edits. Reports are sent
only when tapped online. Offline visual observation therefore comes from the
owner. The agent separately reads authenticated server state. A native value
does not establish visible canvas output: report what the grid actually shows.

## 🛠️ Agent continuation

The private fixture directory is `/private/tmp/spn165`; its immutable archive
and hashes are recorded in the [evidence summary](evidence/SPN-165/baseline-summary.json).
`build-identity.json` binds production source hashes, diagnostic observer/config
and every output asset. `phone-window.ts` checks these before serving and refuses
an existing run directory. It runs the real app with a fresh SQLite database,
checks runtime/worker/invitation readiness, and owns only its own server/tunnel.

From the repository, open a fresh window with the following command, replacing
the run suffix with a never-used name. Inspect that directory's `ready.json`
before giving its invitation to the owner; do not publish private account data
in maintained evidence.

```bash
PATH=/Users/mxbaylee/.nvm/versions/node/v26.13.0/bin:$PATH \
SPINEL_PHONE_RUN=/private/tmp/spn165/phone-next-window \
node scripts/serial.ts node /private/tmp/spn165/guard.ts phone-next-window \
node --max-old-space-size=128 /private/tmp/spn165/phone-window.ts
```

Use pinned Node and `scripts/serial.ts` with `guard.ts`; the existing eight-minute
limit and 2 GiB/system-pressure boundaries apply. Never run another local
test/build concurrently. After expiry, verify owned process cleanup and retain
the first report/failure before preparing another window. No blanket device
reruns, BrowserStack substitution, waiver or exception is authorized.

After diagnosis and repair, repeat the relevant actions on the exact reviewed
candidate and record that source/runtime separately. Physical before/after is
pending; emulation, desktop/native probes and reviewer grades cannot satisfy it.
