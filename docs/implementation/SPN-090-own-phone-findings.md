# SPN-090 own-phone findings 📱

_Recorded 2026-11-11, updated 2026-11-13. Status: findings, not decisions. Owner: Bee. Linked from
[SPN-090](SPN-090.md)._

An owner run on a **personal Android phone, Chrome**, against a local build behind a
Cloudflare quick tunnel. It is the first run outside BrowserStack, and it found offline
failures the BrowserStack lanes did not report. Read this before trusting the Chrome row
in [offline](../offline.md).

Each item says whether it was **observed** (on the phone, by Bee), **read from code**
(not run) or **unknown**. Code readings are leads for the next agent, not proof.

## 🧪 How the run was set up (to repeat it)

- Local server: `npm run build`, then
  `APP_ORIGIN=https://<tunnel-host> DATABASE_PATH=<throwaway>.sqlite npm start`.
- First admin: `npm run setup` with the **same** `APP_ORIGIN` and `DATABASE_PATH` as the
  server. A different `DATABASE_PATH` issues a token the server cannot see and the setup
  page says "This setup link expired or was replaced." (observed, then confirmed in the
  two SQLite files).
- Passkeys bind to the tunnel hostname, so a new hostname needs a fresh database.
- Admin accounts cannot open documents. Create an everyday invite in Admin, **A new
  account**, and open it in the phone's Chrome.
- Tunnel: `cloudflared tunnel --url http://localhost:3000` registered **no** edge
  connections on this corporate network (`/ready` returned `readyConnections: 0`, public
  host answered Cloudflare error 1033). `--protocol http2` worked. Cause of the QUIC
  failure was not proven.

## 🔎 Observations

| #   | What happened                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Source                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | Doc and Sheet created, image and text in the Doc. **Available offline on this device** completed; the file list showed "available offline". Chrome offered **Install** and **Create shortcut**; Install was used.                                                                                                                                                                                                                                                    | observed                |
| 2   | **Request storage protection** at first said "did not grant". After install, the modal said "Your browser granted storage protection. Device copies are not a backup." The button's disappearance and the confirmation were easy to miss on a phone.                                                                                                                                                                                                                 | observed                |
| 3   | **Cold launch, offline.** Chrome and the installed app force-stopped, airplane mode on, Home screen icon tapped: the page stays on the gem-only loading screen indefinitely. No "could not start" message appeared after a minute. Same on a second try. Turning airplane mode off opened the app almost immediately.                                                                                                                                                | observed                |
| 4   | **Warm offline open.** App open and online, doc opened once, airplane mode on, Home, open the downloaded doc: "Loading your files…", then "This item isn't available", with "Failed to fetch" beneath. Repeated twice with the doc freshly redownloaded and shown as available offline.                                                                                                                                                                              | observed                |
| 5   | Bee was **signed out** at some point while toggling airplane mode and had to sign in again after reconnecting. Cause unknown.                                                                                                                                                                                                                                                                                                                                        | observed                |
| 6   | **Remove from device** said the document must not be open in another tab. Only the phone was in use (Chrome tab and installed app may both have been open).                                                                                                                                                                                                                                                                                                          | observed                |
| 7   | The mobile header wraps to two lines; the system/light/dark control is large.                                                                                                                                                                                                                                                                                                                                                                                        | observed                |
| 8   | **Pasting an image from the clipboard** into a Doc refreshed the page and rejected the change (2026-11-13, new-build run on the fresh tunnel). Device, browser, image source and online/offline state were not recorded. Not reproduced, cause unknown.                                                                                                                                                                                                              | observed                |
| 9   | **Offline edit did not sync from the list view.** Doc edited offline and saved on the phone, airplane mode off, phone left on the file list, online: the edit was absent on the computer. Opening the Doc on the phone synced it, after a brief false "offline" message that cleared by itself. Observed 2026-11-13.                                                                                                                                                 | observed                |
| 10  | **Installed icon looks off-centre** on a Pixel launcher (top-left). Measured on the 512 px icon: the heart's outline is centred, but its visual weight was 19 px (3.7%) high and reached the edge of the safe circle. Moving it down 3.7 units centred the weight but left the outline 22 px low (looked low on the phone). Phone trials: 0 units looked high, 4.5 looked low, so it now sits 2.5 units down, chosen by eye; a test guards both and the safe circle. | observed, then measured |

## 🧭 Leads read from code (not run)

- **Warm offline open (item 4).** [web/Dashboard.tsx](../../web/Dashboard.tsx), the effect
  near line 436, fetches `/${currentId}` for any item when the app did not start offline
  (`local` false). On a network failure it reuses the saved view only when the item is a
  `folder` (about line 461). A doc or Sheet falls through to `setError(failure.message)`
  and `setViewMissing(true)`, which renders `AccessState kind="missing"` and the raw
  fetch error. The downloaded copy is never tried. The offline-start path (`local`)
  skips the fetch. This matches the screen exactly.
- **Raw error text (item 4).** `error` is the fetch `TypeError` message and is shown at
  about line 1632 of `Dashboard.tsx`.
- **Cold-launch hang (item 3).** [web/main.tsx](../../web/main.tsx) `boot()` awaits
  `runtimeRequest('bootstrap', …)` and then `start()`. Only the stylesheet load has a
  timeout (10 s, then the "could not start" text). I found no timeout on the service
  worker request or on the saved-data admission that precedes showing the app. The
  startup evidence journal is compiled in only when `VITE_SYNC_EVIDENCE=1`, so the
  production build records nothing about where it waited.
- **Remove from device (item 6).** The lock exists so another tab cannot write while the
  copy is replaced ([web/offline/OfflineSession.ts](../../web/offline/OfflineSession.ts)
  lines 305-308). Whether memory-only removal with an unsaved-changes warning is
  feasible was not read.

## ⚠️ Impact on earlier records

- BrowserStack Chrome acceptance never reported the **warm offline open failure** or the
  **cold-launch hang** as such. It reported lost origin data after a relaunch. Whether
  those runs hit the same defects was not established.
- The earlier hypothesis that attaching a new ChromeDriver session clears Chrome's data
  is neither confirmed nor ruled out. After the cold launch the file list still said
  "available offline", but the doc was never opened offline from a cold start, so
  whether the saved copy survived a force-stop is **unknown**. Two app-side failures
  (items 3 and 4) could explain a failed offline open without any lost data.

## 📝 Follow-up candidates

1. Open a downloaded Doc or Sheet from the saved copy when the network fails after a
   warm start (item 4). This is SPN-090's own first scenario, not a follow-up.
2. Bound or surface the offline cold-launch wait (item 3), and branded loading ("spinel"
   wordmark with the gem).
3. Never render raw browser errors; say the device is offline instead of "may have moved
   or you may no longer have access".
4. Explain the unexpected sign-out (item 5).
5. Storage protection: visible confirmation, wording that the browser decides, and a hint
   that installing helps.
6. Remove from device: clearer wording ("another window") and, if safe, removal with a
   warning.
7. Mobile header: smaller theme control with less padding.
8. Image paste refreshes the page and drops the change (item 8): reproduce with a known
   clipboard image, check the console and server log for the failing request, and whether a
   session expiry or the new `itemsRequest` timeout is involved.
9. Sync on reconnect from the list view (item 9). `docs/offline.md` (Sync, near line 623) says
   sync is attempted on startup, on returning to the foreground and when the connection
   returns, while the app is running; this run suggests only an open Doc's editor does it.
   Read: the sync client is created per open editor and its `online` and foreground listeners
   are added in `binding.watch` and removed in `dispose` (`web/spinelSync.ts`, about lines
   1189-1216), so nothing sends pending edits while only the list is open. A Dashboard-level
   flush would need to run the sync client without an editor, which is ticket-sized; the
   smaller options are a visible "changes not yet synced, open to sync" marker on the file
   row, or correcting the contract wording. Also the transient false "offline" message when the Doc opens.
10. An on-device diagnostics view for startup steps, since a personal phone cannot be
    USB-inspected by every agent.

## 🔄 Investigation log

_Code reading only, 2026-11-11. Nothing below was run or reproduced._

**Warm offline open (item 4): confirmed by reading.** _(Line references describe the code
before the 2026-11-13 fix.)_ The `Dashboard.tsx` view-load effect (the `itemsRequest`
call) reuses a saved view on a network failure only for a `folder`. A Doc or Sheet
cannot take that branch, so it shows the raw error and the missing state. The offline
start path (`local`, entered from `App.tsx` when the session request fails with a
`TypeError`) skips this fetch, which is why a cold offline start would not hit it.
The fix belongs in this effect: a prepared account opening a downloaded Doc or Sheet
should use the local copy on a network failure, as it already does for folders.

**🔌 Warm offline open (item 4): fixed locally, 2026-11-13, not yet on a phone.**
`viewAfterNetworkFailure` in [web/offline/warmOpen.ts](../../web/offline/warmOpen.ts)
decides what a failed item request may show: the saved folder listing as before, or,
new, the downloaded Doc or Sheet (`Dashboard.tsx` then renders `OfflineViewer`
through `deviceOpenId`, with the frame offline and server-only actions off). It applies
only to a network failure for the prepared account; a server denial stays authoritative.
The saved view that lists the item is reused so its ancestors stay; the lists are read
through a ref so a late first load is not missed.

- **Checks run (Node 26.13.0):** [src/ui/warmOpen.test.ts](../../src/ui/warmOpen.test.ts)
  (7 pass), `tsc -p .`, `oxlint --deny-warnings` and `prettier --check` on the changed files.
- **Review:** graded by two independent agents against
  `notes/spinel-warm-open-fix-rubric-notes.md`; per-round scores and the fixes are recorded
  there, not here.
- **Not tested at the Dashboard layer locally.** Vitest runs in a Node environment with no
  component harness, so the wiring (`deviceOpenId`, the offline frame, `OfflineViewer`) is
  read, not run. A Playwright case in `e2e/offline.spec.ts` ("a warm Dashboard that goes
  offline opens a downloaded Doc from the device") covers it on the hosted runner and has
  not been run. Phone confirmation is pending.
- **Known gaps, deliberately left:**
  - The item's row must already be in memory (`items`, shared items or a saved view). A deep
    link to a downloaded Doc opened before any list loads still ends in the unavailable
    screen. Building a row from the download record would invent metadata (access, parent,
    timestamps), so it was not done. The offline-start path is the supported route there.
  - On reconnect (`connection` returns to online) a device-copy open refetches once: success
    returns to the live editor, failure keeps the device copy. Read, not run on a phone.
  - The item request had no timeout, so a hanging connection sat on "Loading your files…".
    It now stops after 15 s; that `TimeoutError` counts as an outage for this fallback, and
    otherwise shows "Spinel did not answer" instead of waiting forever.
  - A deep link to a downloaded Doc could consult the persisted catalog row (the source
    `local` mode reads) instead of inventing metadata; not done.
- **Files in this change:** `web/Dashboard.tsx`, `web/offline/warmOpen.ts`,
  `src/ui/warmOpen.test.ts`, `e2e/offline.spec.ts`, `docs/offline.md` (one paragraph) and
  this note.

**Cold-launch hang (item 3): not isolated; two candidate stall points.**

1. `App.tsx` startup runs `restoreAccountExit()` and `withAccountRead()` before the
   session request. Both go through `exclusive()` in
   [web/offline/accountExit.ts](../../web/offline/accountExit.ts) line 112, which awaits
   `navigator.locks.request(LOCK, …)` with **no timeout**. If another Spinel context
   (a second tab or the installed app window) holds the lock, startup waits forever and
   the `loaded` flag never turns true, which leaves the gem-only screen. Bee's phone
   may have had both the Chrome tab and the installed app open (item 6 hints at it).
   This is unproven.
2. The session request in [web/api.ts](../../web/api.ts) uses `AbortSignal.timeout(15_000)`.
   A timeout is a `DOMException`, not a `TypeError`, so `isNetworkFailure` returns false and
   `App.tsx` (about line 303) shows the error instead of entering offline mode. A network
   that hangs instead of failing fast would therefore never reach the offline copy.
   Airplane mode normally fails fast, so this is less likely for item 3.

Other startup waits are bounded: the service worker request (3 s), offline admission
(3 s) and styles (10 s). Neither stall point explains why no message appeared, which
fits a lock that never grants.

**Sign-out (item 5): unexplained.** `App.tsx` treats an HTTP 401 on the session request
as a real sign-out and calls `expirePreparedAccount()` (about line 304). A 401 should not
happen offline. Possible causes to check: the tunnel or server returning 401 while
reconnecting, the throwaway server restarting with different state, or a second context
completing a sign-in or exit. Not tested.

**Phone run on the fix build, 2026-11-13 (observed by Bee).** Warm offline open worked
(slow "Loading your files…", then the Doc opened; after airplane mode off the page refreshed
and was live). Cold launch with only the installed app, airplane mode on: gem screen for about
25 s, then the signed-out sign-in screen, which cannot sign in offline. This matches
candidate 2 above, not the lock: the session request hit its 15 s `TimeoutError`, which was
not treated as an outage, so startup showed sign-in instead of local mode. It also explains
the earlier unexplained sign-out (item 5) as likely the same path. Fixed locally by
counting `TimeoutError` in `isNetworkFailure`; not yet re-run on the phone. The 25 s wait
itself is unexplained (why airplane mode hangs instead of failing fast).

**Cold launch, second phone run (observed, then read from code).** On the build with the
`TimeoutError` fix, airplane mode on, installed app only: more than a minute on the gem and the
new startup status line (`web/startupStage.ts`, shown after 8 s) never appeared, so the page's
JavaScript had not started. The service worker's page-load handler (`navigate` in
`web/service-worker.ts`) awaited `fetch(request)` with no deadline and falls back to the saved
shell only after that fetch rejects; airplane mode can leave it pending. That fits the
variable 25 s to more than a minute waits. Fixed locally (skip the fetch when
`navigator.onLine` is false, 8 s deadline otherwise); not yet re-run on the phone. The service
worker only changes after an online open of the new build.

**Cold launch, third phone run (observed).** With the service-worker fix active, airplane mode
on, installed app only: the gem went away after a few seconds, the status line showed
"sign-in check" for about 11 s (the session request waiting out its timeout), then the
downloaded Doc opened offline. The cold-launch hang (item 3) is resolved on this device.
Follow-up applied locally: when `navigator.onLine` is false, skip that wait and start from the
saved files; not yet re-run on the phone.

**Next evidence to collect.** One run with only the installed app (Chrome tab closed)
to test the lock theory, and an on-device startup log, since the production build
records nothing about where it waits.
