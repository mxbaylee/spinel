# 📱 SPN-164 reconnect baseline

**Pending physical execution.** This is an observation build, not a timeout fix.
Use only the fresh invitation/document links supplied with the current guarded
test window. The ordinary Owner and notebook are disposable; no existing account,
deployment, downloaded files or passkeys are replaced. A new tunnel hostname needs
its own fixture/passkey. Do not clear storage or uninstall an existing Spinel app.

## 🔬 Exact build and capture

Production baseline: `c17c74d9225b3317541696dd6ea6c4a4c713f7be`. The explicitly
selected `scripts/ci/startup-phone.config.ts` injects timing observations into
unchanged production source. The handoff manifest records the actual fixture
source hashes, runtime version and every emitted asset hash. It is **not** the
historical `ccc201ef243022d572e2764fd26c1e928f2582c0` incident build.

The small **Send test timings** button is a fixture control. It sends only the
latest 128 stage/request/connectivity timestamps, fixed error classes, HTTP
status, page/request ordinals and collection-loss flags. It sends no document
text, account identity, cookie, URL or raw error. Reports are sent only when
tapped, so a probe does not compete with the reconnect request. Page reloads
retain the session's bounded trace; process termination/storage loss can lose it.
The fixture server separately records bounded session arrival/finish/close
timings. Browser/server clocks are not assumed synchronized.

## ✅ Required phone actions

1. On the **Pixel 10**, open the fresh invitation in Chrome and create the test
   Owner's passkey. Install this test origin using Chrome **Add to Home screen →
   Install**, then launch that icon. Close the test origin's Chrome tab so only
   the installed instance is open. Keep other Spinel installations untouched.
2. Open **SPN-164 reconnect notebook**. Confirm both paragraphs:
   “Reconnect notebook” and “Keep this paragraph.” Use **Document actions →
   Available offline on this device**, wait for its availability confirmation,
   then **Done**. Return to the file list. Tap **Send test timings** once to
   confirm capture works before changing connectivity.
3. Keep the installed app open. Turn airplane mode **on** and ensure Wi-Fi is
   off. Return to the app and note its offline state. Turn airplane mode **off**,
   return immediately to the installed app, and leave it on the file list.
   Note the startup stage, approximate wait and resulting screen. If it remains
   stuck for 30 seconds, preserve that first outcome; do not refresh to hide it.
4. Tap **Send test timings** once connectivity permits. Reopen the notebook and
   confirm both paragraphs remain. Reply with the observed result, Android and
   Chrome versions, and whether the timing button said **Timings sent**.

No manual stopwatch precision or developer-tools setup is needed. A run with no
new sign-in check is useful evidence, not a reproduced stall. Do not repeat a
failure into a pass; an additional cold/warm launch will be requested only if
the first trace shows why it is necessary. The after-fix run remains separately
required once the actual failing boundary and bound have been chosen.

## 🛠️ Agent preparation and cleanup

Use pinned Node 26.13.0 and the serial memory watchdog. Build once into a fresh
absolute disposable directory using `SPINEL_PHONE_DIST` and the explicit config;
normal builds never load this observer. Retain the immutable source/asset manifest
before hosting. Start the real `createApp` against a fresh throwaway SQLite fixture
and that static directory, behind a guarded HTTP/2 tunnel. Verify the served
index/runtime hash, actual invitation response and collector origin/size limits
before issuing links. Run no concurrent local test/build while hosting.

The local host window is bounded by the existing eight-minute serial budget;
resource pressure can end it earlier. If it closes, report **fixture unavailable**,
preserve first results and arrange a fresh window. Never treat tunnel failure as
phone failure, never reuse an expired invitation, and never erase another task's
processes or data. Private fixture accounts/raw reports remain outside the repo;
retain verified archival hashes and a bounded maintained evidence summary.
