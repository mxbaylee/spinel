# 🖥️ SPN-090 local BrowserStack execution checkpoint

November 5, 2026, agent judgment following the owner's request to use local
BrowserStack commands with `SPINEL_BS_USERNAME` and `SPINEL_BS_ACCESS_KEY` from
`~/.zshrc.env`. Source at verification:
`29b465b42f5616a1c3e18007cd9561b6a008e211`, tree
`091d6bf932c08031c62c555adcff6e3a3cbfe16d`. This checkpoint does not claim a
physical phone acceptance pass or completion of SPN-090.

## 🔐 Direct provider access works

Sourcing the two variables with tracing disabled authenticated a direct local
BrowserStack account API request. A bounded local GET then retrieved the already
completed Chrome session's Appium log without GitHub Actions and without a new
device allocation. Authentication values and raw provider logs were not retained.
The sanitized read matched the previously retained946,296-byte log SHA-256
`70973043443adeff797a47c01c5bed721d673c48541d9f4c6c7513f027455e6b`.
Its128 retained lifecycle rows,71 omitted rows and one malformed targeted record
support a reattachment/reinitialization lead, not proof of storage erasure's
cause. Nearest requests are explicitly uncorrelated. No new paid session was
created by these commands.

The normal `browserstack-capability.ts prepare/run` CLI still requires GitHub
identity. Do not fabricate GitHub run variables to present a local run as CI.
A local full-run wrapper must retain explicit local source/build identity,
one-use execution, account-idle check, existing native journey and cleanup.
BrowserStack documents the [Local binary and its configuration](https://www.browserstack.com/docs/local-testing/binary-params);
a private tunnel is required for phones to reach this HTTPS fixture.

## 🧰 Isolated fixture preparation

A copy-on-write clone of the existing dependency directory avoided another full
`npm ci` after prior resource-aborted installs. It is an **isolated reconciled
clone**, not a clean-install or reproducible-install claim. The shared donor
was not patched. Actual installed versions were checked for486 packages, all
seven workspace links point to this current source, and runtime resolution was
checked for build tools, native canvas, Core/Docs and synchronization packages.
The sole hidden-lock mismatch was body-parser2.3.0 versus locked2.4.0. Its exact
committed-lock tarball passed SHA-512 SRI; the complete owned package was replaced
and its actual resolved runtime dependency ranges checked. All five existing
public Univer patchers passed their version/hash guards on the owned copy.

The dependency directory now belongs to this worktree, at
`/Users/mxbaylee/projects/spinel-spn-090-production/node_modules`. Workspace links
resolve into this worktree's `lib/`. The donor remains at the main worktree.
Setup failures remain recorded: the first version inventory mistakenly treated
workspace metadata as copied package paths; the first resolver attempted an
unexported `package.json` subpath. Their corrected inspections did not repeat
package fetching or relax version/SRI checks.

## ✅ Local feasibility results

All commands used the shared serial runner and normal-pressure/2GiB process-tree
watchdog with a60-second bound; no browser, tunnel or paid device was started.

- A single production build, `VITE_SYNC_EVIDENCE=1`, passed in5,562ms with
  1,177,728KiB peak. The existing build inspector's local wrapper retained explicit
  local identity, exact source/tree/lock/script hashes and all final emitted file
  hashes. Renderer boundaries passed for78 modules and48 emitted files totaling
  14,493,521bytes; both editors retain the renderer and offline shell membership.
- Full `npm run typecheck` passed in5,694ms with1,769,328KiB peak.
- The actual HTTPS production fixture seeded all four normal/conflict Docs and
  Sheets, served the built sign-in HTML with the server's public-origin metadata,
  and shut down successfully in2,168ms with430,736KiB peak.

Two initial smoke assertions were wrong and remain preserved. The raw built HTML
is a template whose public metadata is substituted by the server; anonymous `/`
redirects302 to sign-in. The final check uses the source-defined public `/sign-in`
route and compares the entire expected substituted HTML, status200 and hash.
These were smoke-harness assumption failures, not evidence that production
serving failed. The first attempt retained only an AssertionError class, so its
exact assertion remains unavailable; the second retained the302 status/hash.
All three fixture attempts report successful owned cleanup.

## 🚧 Remaining physical boundary

The ordinary current-source CI audit passed all33 jobs and seven gates; current
native/Storybook/visual evidence is separately retained. Local feasibility does
not replace the pending physical Safari and Chrome acceptance contracts.

The shared local runner has an8-minute limit; the authored phone lane permits
780 seconds plus cleanup. A full local lane needs an explicit compatible
resource/exclusivity plan before allocation. Do not silently renew a timer,
bypass the shared lock, shorten the acceptance journey or invent a CI identity.
The previous failed Safari input and Chrome storage outcomes remain open. This
checkpoint does not allocate a further attempt or renew an exhausted diagnostic.

Operator benefits from faster private diagnostics and an isolated dependency
fixture; Owner and Collaborator retain actual edit/persistence requirements;
Link guest exclusion and authority remain unchanged. The full outcome remains
XL. Work stays limited to SPN-090 and SPN-146, then stops as requested.

The local request used `rejectUnauthorized:false` for the disposable self-signed
fixture. Its pass establishes local serving and cleanup, not provider certificate
trust or browser rendering. A provenance correction separately retains the
actual `@univerjs/sheets-drawing` ES/CJS patch hashes; the initial hash inventory
incorrectly labeled unpatched `@univerjs/drawing` as that patch target. The guarded
patch itself targeted sheets-drawing correctly; no patch or build was repeated.
