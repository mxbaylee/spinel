# 🔕 SPN-106 independent review A

Reviewed head: `ae39bab3c1ba89460418f934765b67327cd601ec`.
Actual base: `c1d0d6e8ded33c10cf555ed2ed05ffd9ebc3a423`.
Worktree: `/Users/mxbaylee/projects/spinel-spn-106-current-main-20261114`.
Reviewer: independent nonimplementing subagent `/root/spn106_current_a`.

**98/100. One local evidence-attribution correction remains; no product correctness or visual blocker found. Agent review only.** No prior grades, other reviewer conclusions or PR body were consulted. The numerical score does not permit skipping the required local repair/review loop or pending hosted acceptance.

## 📖 Scope inspected

I read the complete review packet, original base ticket, complete implementation record, governing AGENTS/process/run-backlog/testing/personas guidance and relevant design playbook (README/editor/guest/states/review-runbook), theme documentation and palette/theme implementation. I inspected every executable change relative to the actual base, the native service and its real native-controller tests, the service preparation controls, application startup/PDF/guest notice assertions, mounted native story and existing guest revocation journey, production integration and current OSS public declarations/startup source. I inspected the prospective backlog diff and exact-head PR-check receipt.

The original specification is byte-identical to the preserved evidence copy (independently compared with `git show BASE:docs/todo/SPN-106.md`). Head was clean and exact before tests and at final inspection. The complete delta from production source `141fa3aca4b4fb3a127e4983a21e975fe9e333ec` to this head contains documentation/evidence/bookkeeping only. That supports source equivalence; it does not claim all recorded runtime checks reran on this SHA.

I read production and phone/Storybook receipts, decompressed browser reporter results, capture log/config, checked stored and decoded hashes for all artifacts listed in both receipts, independently checked all eight original PNG hashes/dimensions, and verified compressed static-check receipts/log hashes. Static checked executable source is `0320e521b606f0f0b6eab224ea762897f93351fe`; exact candidate PR checker is recorded separately. The root audit was supporting evidence, not a substitute for image/code inspection.

## 🧮 Rubric

- **Scope and acceptance: 35/35.** The complete M outcome is retained: precise automatic viewer startup refusal; plain/stale-field account/guest load and reload; desktop/phone; data/grants; truthful actual denials; concurrent authorized editing and revocation; PDF; native/platform and visual acceptance. No follow-up hides an acceptance obligation. Hosted execution remains explicitly pending rather than excused by the grade.
- **Correctness, integrity and authority: 25/25.** The `CommandService` override uses the public constructor/dependency override and only refuses the exact command, exact unit and `onOpen === true` while the binding is a viewer. Both public entry points return false without executing/listening; all other operations delegate to native enforcement. Live grant state changes remain authoritative. No Pro dependency/patch, notification mute, CSS concealment, role upgrade or stored-field rewrite is introduced. Owner preparation establishes an honest native baseline; separate first-owner/account/guest controls establish that this does not conceal first-viewer preparation changes.
- **Regression protection and evidence: 18/20.** Meaningful native, server, browser and mounted controls preserve full snapshots/heads/receipts, original rows/grants and actual denial. My bounded controls passed. Deduct two points solely for the canonical result attribution error detailed below, not any CI result or pending hosted work.
- **Delivered workflow and operational usability: 10/10.** Existing file/shared-dependency selection remains broad, no job/threshold/retry/gate was weakened, and missing/failed selected work retains the existing fail-closed owners. Preparation diagnostics allowlist error text rather than credentials. Evidence identifies source/build/test boundaries and cleanup. Resource-aborted development and first setup failures are retained without causal overclaim.
- **Maintainability, documentation and avoidable complexity: 10/10.** Small binding-local subclass and a shared notice observer are proportionate to actual callers. No speculative framework or dependency was added. Tests use existing fixtures/owners. Extensive audit records are justified by retained historical failure and platform provenance; the one attribution correction is counted once above. Ticket removal, original Rules preservation, ID161/date preservation and generated index are consistent prospective landing work.

## 🔎 Finding and every step to 100

**A1 — P2, evidence attribution; 2 points; local documentation repair.**
`docs/implementation/SPN-106.md:438–443` says both stale-field and plain branches completed the concurrent owner edit. `docs/implementation/SPN-106.md:488–495` attributes a denied HTTP write and concurrent edit/revocation to both guest branches. The actual executable contract is narrower:

- `e2e/documents.spec.ts:203–209` only sends the denied document PUT for `role === 'account'`. The guest branch checks anonymous dashboard denial (`GET /api/items` returns401), not a denied document write.
- `e2e/documents.spec.ts:212–237` runs the concurrent authorized edit only under `!fields`, and guest revocation only inside that plain-content branch.

The decoded first-attempt reporters identify exactly the production desktop-account and phone-guest cases, so their success cannot establish branches the code does not execute. This matters because the maintained acceptance record must distinguish the authority proof actually obtained. It is not an observed permission bug.

Smallest complete fix: rewrite both result paragraphs to say initial/reload notice and complete integrity checks passed for both plain/stale-field variants; account HTTP write denial passed in the account case; concurrent owner editing ran in the plain variant; guest dashboard denial passed and live link revocation ran in its plain variant. Remove the guest HTTP-write claim. Do not rerun browsers or add redundant tests to make the prose true. Keep real native denial attributed to the separate mounted story/native suite. I found no matching false HTTP-write claim in the raw phone receipt or its gallery README. Commit the repair, perform appropriate document/diff checks, and obtain exact-new-head revalidation from both reviewers.

This is the complete list of local deductions. No owner decision is needed. No points are withheld for hosted-only acceptance, and no other step to 100 is hidden.

## 🧪 Independent local execution

The manager allocated the sole workload slot. I verified candidate-private `node_modules`, Vitest and `.vite` real paths; every `@spinel/*` workspace link resolved to this candidate's `lib/`. I made only an ignored reviewer config/cache under `node_modules/.cache/spn106-review-a-ae39/`; no donor/root dependency mutation or installation occurred. The config imports the candidate's `vitest.config.ts`, retains `maxWorkers:1`, sets an absolute private `cacheDir` and `test.cache:false`.

Each command below ran from the candidate using pinned Node26.13.0, `/tmp/spinel-dependabot-2026-11-11/watch.ts`, then the candidate `scripts/serial.ts` shared lock. The guard requires pressure1 before starting and throughout, combined tree RSS at most2GiB and elapsed at most8minutes. No limits were raised.

Initial reviewer setup mistake, preserved separately: private config used `../../../../vitest.config.ts` instead of `../../../vitest.config.ts`, so Vitest could not load config. Zero tests executed; code1,350ms,peak171840KiB, no resource abort. Log `/tmp/spn106-review-a-preparation-ae39.log`; receipt `/tmp/spinel-dependabot-2026-11-11/spn106-review-a-preparation-ae39.json`. I immediately released the slot and reported it. This is a reviewer setup failure, not a candidate test verdict. The manager authorized a material setup correction and reallocated the slot; I verified the corrected import resolves exactly to candidate `vitest.config.ts` before execution.

Successful exact commands (the watch wrapper invokes the serial runner):

```sh
/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn106-review-a-preparation-corrected-ae39 /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run --config node_modules/.cache/spn106-review-a-ae39/vitest.config.ts src/server/collaboration/service.test.ts -t 'Doc preparation preserves saved content and viewer authority'
/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node /tmp/spinel-dependabot-2026-11-11/watch.ts spn106-review-a-native-ae39 /tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run --config node_modules/.cache/spn106-review-a-ae39/vitest.config.ts src/ui/nativeSyncPermissions.test.ts
```

Preparation: **6 passed**,24 deliberately skipped,2915ms guarded,peak1075536KiB,code0/no abort. Native permissions: **13 passed**,877ms guarded,peak777408KiB,code0/no abort. Raw logs: `/tmp/spn106-review-a-preparation-corrected-ae39.log`, `/tmp/spn106-review-a-native-ae39.log`. Guard JSONs use those corresponding names under `/tmp/spinel-dependabot-2026-11-11/`. Slot release was reported immediately after completion. I ran no browser/build/compiler/full-matrix or unsupported Linux checks.

## 🎨 Eight-image independent visual review

**Visual disposition: approved for exact candidate `ae39bab3c1ba89460418f934765b67327cd601ec`, agent review only.** Each image was opened individually with `view_image`; this is not approval inferred from a manifest or test pass. No new alternate design/pattern is proposed: this restores quiet reading and retains established truthful denial.

Under `docs/review-assets/spn-106-production-20261114/`:

1. `spn-106-account-desktop-light.png`: real production account viewer,1280×960, light. Full title/access/status header and readable body, no false warning. Existing disabled native controls remain visually subordinate.
2. `spn-106-account-desktop-dark.png`: same real route/dimensions, dark. Cosmic-purple shell, dark native paper and readable light body; no warning or new clipping.

These use production test build source `141fa3aca4b4fb3a127e4983a21e975fe9e333ec`, with read-only selection evidence enabled, not an uninstrumented shipping-bundle claim.

Under `docs/review-assets/spn-106-guest-storybook-20261114/`:

3. `spn-106-guest-390px-light.png`: real production guest route, Chromium mobile/touch emulation390×844, light. Plain title, view-only label, generic people count, visible PDF action and readable body; no account destinations or warning.
4. `spn-106-guest-390px-dark.png`: same route/emulation/dimensions, dark. Guest isolation and readable text preserved; no warning. These two images reuse the byte-verified141fa production output, with runner source5afac.
5. `docs-mobile--viewer-phone.png`: mounted native Storybook fixture390×900, light. Full Autumn notes body reflows with readable line length; view-only header and no editing controls/warning.
6. `docs-mobile--viewer-phone-dark.png`: same mounted fixture/dimensions, dark. All paragraphs remain visible and readable without warning.
7. `docs-mobile--viewer-denied-edit-phone.png`: mounted native fixture390×900, light after actual public Doc insertion refusal. Full text is still visible beneath the real native warning; message wraps within phone width and includes warning icon/text.
8. `docs-mobile--viewer-denied-edit-phone-dark.png`: corresponding dark denial. Complete body remains visible; native purple warning surface has legible message and icon. Header overlap is the retained truthful native denial state requested by the ticket, not a startup obstruction or a new design pattern.

The four mounted images use source `5afac055559e43cc06c0e399a0f61babd2864962`. Real configuration/preview and production chrome/theme are imported; these are not real account/guest routes or physical-phone evidence. I checked that the story asserts completed layout/reflow, unchanged body/style/settings, false insertion and one real permission error. Images of the modern production canvas display body text, not the saved header/footer fields; field preservation comes from exact data assertions. Original image bytes and source equivalence are preserved at the reviewed head. No physical-device, full-catalogue or unsampled viewport claim is made.

## 👥 Persona assessment

- **Owner:** complete authored/stored fields and grants are guarded by exact assertions; readers cannot turn initialization into an edit. The plain-case authorized owner still edits alongside a viewer.
- **Collaborator:** quiet reading and clear view-only state reduce false alarm; explicit edits and refresh retain native denial, and grant upgrade/downgrade controls remain meaningful.
- **Link guest:** phone content and PDF action are usable without account navigation/identity. Pre-navigation notice history detects startup warnings; real revocation removes the canvas. Native story denial is accurately distinct from production guest-route evidence.
- **Operator:** no new service, access right or dependency; finite guarded execution and retained failure/cleanup evidence support operation on the small host. Correcting A1 improves trust in its acceptance record.

## 🚦 Remaining acceptance and conclusion

The fresh complete development/production account/guest desktop/phone matrix (including unsampled phone-account/desktop-guest), PDF and editor-revocation owners, applicable native/sync/mobile/performance/offline/restore/transition workers, full current Safari/Chrome/Firefox and selected full Storybook catalogue/viewport checks remain pending exactly as assigned in the canonical record. All seven current-head gates plus applicable additional checks remain merge requirements. Historical Safari cause remains unresolved; the development resource abort/setup failures are not erased by bounded production success. I did not inspect CI results or deduct for them.

Repair A1 locally, then revalidate the new commit. No implementation change, metadata write, push, merge or branch cleanup was performed by this reviewer.
