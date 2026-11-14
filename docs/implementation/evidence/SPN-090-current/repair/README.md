# 🔧 Review repair and regression evidence

This repairs the findings on `433092106839493d987668cac1791d548d4c15b1` before any
validation push. [Receipts](receipts.json) identify final source content, each guarded
attempt and resource measurement. Prior results remain historical, not current approval.

## ✅ Findings and disposition

- **Mounted offline editor:** Dashboard no longer requests a metadata handoff on reconnect
  or clears the mounted device editor on incidental refresh. The existing native binding
  reconnects and enforces authority in place. Explicit navigation remains dirty-aware.
  The frame receives its actual connection state; device-copy actions stay conservative.
- **Native content:** the warm/deep-link Doc case uses the existing offline fixture with
  one distinctive complete paragraph and asserts its exact native clipboard text after
  both transitions, plus real canvas readiness. A real 403 refuses the same saved copy.
  Existing missing-copy unit and browser owners remain intact.
- **Unfinished input:** the real Sheet case keeps the same native canvas and exact copyable
  cell draft through reconnect. It checks the server is unchanged before Enter, then
  separately checks native Synced and the exact acknowledged server cell after Enter.
  A held/rejected route would intercept the obsolete Dashboard metadata request; the
  repaired Dashboard issues none. Native collaboration authority and socket traffic
  continue normally. This is not a promise of file-list replay (SPN-156).
- **Deep-link integration:** the stronger browser test exposed a remaining first-list
  loading gate. A verified device-copy open now renders even when the live root list
  failed. Background list errors remain in state for returning to the list and do not
  cover the admitted editor's own save/access UI.
- **Worker deadline:** the existing production fetch-event test now drives a pending,
  abort-aware online fetch through its deadline to the complete public cached shell.
  It also proves known-offline skips fetch, server-only routes never obtain that shell,
  and their online requests have no artificial shell deadline. The storage boundaries
  are fixtures; the production navigation handler and route selection execute.
- **Documentation:** offline installation resources point to the actual before/after
  manifest/icon-byte assertions; online PWA checks remain separately attributed. SPN-154
  distinguishes the later Pixel/Chrome clarification from unknown specific paste conditions.

## 🧪 Final results and first failures

- Both focused production browser cases pass together on the repaired runtime:
  **11.304 s, 1,665,056 KiB peak**, one worker, zero retries. The final source was rebuilt
  after formatting; **every emitted file's name and SHA256 is identical** to the browser-
  tested runtime (`runtime-equivalence.json.gz`). No repeated unchanged acceptance run
  was needed to prove whitespace-only source formatting left the tested output unchanged.
- Worker/shell suite: **37 pass**. Other selected warm/startup/bootstrap/native-binding
  tests passed in the first mixed run; its two failed worker assumptions are preserved.
  The corrected complete warm-catalog test fixture passes all **6** focused tests.
- Full compiler passes **2.190 s, 1,812,240 KiB peak**. The prior resource abort remains
  in the parent record. This changed-source attempt first exposed the older partial
  `FileItem` test cast; the fixture now has genuinely typed required metadata rather
  than a stronger cast. Its diagnostic is retained.
- Full lint, prohibited-dependency check and formatting pass **10.887 s,
  797,840 KiB peak**. Production builds pass under the same guard.
- **Worker negative control:** removing the production timeout makes the pending-fetch
  test fail at the deadline settlement assertion, **346 ms**, not a resource abort.
  Production source was restored before all later builds.
- **Native negative control:** restoring only the old Dashboard reconnect refresh and
  teardown makes the Sheet case fail at the **same-canvas identity assertion**
  (expected true, received false), **21.465 s, 1,480,304 KiB peak**. The current
  connection-state fix remained, so this was specifically editor replacement. The old
  source was restored only for this control, then removed and the repaired app rebuilt.
- **First Doc failure:** the prior helper copies the current paragraph in a modern Doc,
  not its entire multi-paragraph body. The first assertion received `Phone journal`.
  A valid single-paragraph fixture now checks every exact authored fixture word; this
  did not reduce the content assertion to an empty frame or generic success message.
- **Next Doc failure:** native readiness failed on the deep-link branch because the root
  list's loading gate blocked it. A bounded diagnostic confirmed correct saved catalog
  and usable inventory; after the gate fix exact native text passed but raw unrelated
  list errors still overlaid it. Those errors are now retained only for the list view.
  The diagnostic logging was removed. All failure screenshots/context/fixture observations
  are retained in the named archives; disposable SQLite databases are omitted.
- **First worker assumptions:** tests initially treated `/sign-in` as server-only.
  The existing route contract explicitly permits its public-shell fallback so App can
  perform offline admission. Tests and prose now use actual `/invite`, `/setup` and
  `/share/` server-only routes; no routing/privacy behavior was changed.

## 🎨 Visual applicability and remaining gates

Every source hash in the existing eight-image gallery still matches. No new visual
component/style was introduced; the existing connection control now receives the correct
binding state, which the native browser case verifies. Independent reviewers must assess
that gallery's applicability on the new commit. This record is **agent review only**;
implementation checks are not independent visual approval. Full hosted owners and all
seven current-head CI gates remain pending until their actual results are recorded.
