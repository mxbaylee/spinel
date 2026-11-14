# ⬆️ Consolidate the follow-up dependency updates

## 🧭 Scope and early checkpoint

2026-11-12, owner direction: two new Dependabot PRs appeared after aggregate
#240 merged; continue the authorized consolidation and merge without more
permission questions. The monthly configuration remains in place. Reuse #277
as the aggregate and close #278 only after its update actually lands.

Complete outcome estimate: **L**, including nine package updates, saved icon and
emoji compatibility, matching historical comparison sources, two independent
reviews, local guarded checks, hosted native/browser/provider validation,
independent visual approval and branch cleanup. This is the dependency PR title
exception, not completion of an unrelated ticket or a whole-backlog run.

- #277, `73983bb04b30af2da69b42705874c77fa4f55f1c`: S3 3.1162.0,
  MCP SDK 1.32.2, Lucide 1.69.0, ws 8.22.1, React Vite plugin 6.2.1,
  oxlint 1.91.0, Vite 8.3.6 and Vitest 5.1.0.
- #278, `32330c01cb26dfd19e1ee4a0ec474930d223279e`:
  emojibase-data 18.0.0. Its data/schema and saved-value compatibility need
  explicit inspection; a major version alone does not establish incompatibility.
- Base: `f2e36db45a4cd10f3ff2e1358c5a3c457344856a`. The two bot diffs apply
  cleanly together without re-resolving unrelated locked packages. Univer remains
  1.3.1 with the previously qualified five OSS patches; print/Caddy stay unchanged.

## 🔎 Original failures and regression contracts

#277 CI 43221977913 passed all 811 Node tests (2 skipped), then application
Vitest passed 2,048 and failed the complete Lucide export-set contract. The
catalog contains 2,155 export keys while Lucide 1.69.0 exports 2,313. Refresh
release-pinned metadata while preserving every accepted saved spelling and
historical alias. Do not relax the complete export-set assertion.

Historical responsiveness/callback workers fail before observations while
installing old manifests with the new candidate lock. Create reviewed descendants
of the current matched historical sources with the complete new dependency map
and lock, preserving their original algorithms and three historical patchers.
Keep both candidate correctness and paired comparisons selected.

Storybook's original runs 43221977850 and 43222001834 were cancelled during
classification/build; their fail-closed final gates failed because selected work
was missing. They are not observed rendering regressions or accepted passes.
#278 native Safari job 131195571227 in run 43222001951 failed to receive a
native pointer click after loading the document. Preserve that first attempt;
no emoji-data causation is established and no retry/budget relaxation is planned.

Lowest meaningful local checks: fresh locked installation/all patchers; existing
profile catalog/search/alias/avatar and emoji/appearance tests; affected server
transport/MCP checks and build/lint/typecheck as resources permit. Hosted CI owns
all seven gates, historical comparisons, Linux native libraries, actual desktop
browser storage, provider acceptance and Storybook interactions. Existing
light/dark/phone capture fixtures provide visual evidence for the icon picker
and affected application controls. Preserve original failures and exact source,
review, run and measurement identities in the final PR record.

## 👥 Persona decision

Operator gains current tooling, transport and provider dependencies while its
admin account remains unable to access documents. Owner and Collaborator keep
saved appearances, discoverable icon/emoji choices and existing editing/sync
contracts. Link guest retains scoped document access and revocation; member
catalog screenshots do not prove guest authority. Keep saved values and access
policies unchanged, and preserve all current security-update handling and the
approved quieter routine schedule. No new design or AI product feature is added.

## 🧩 Compatibility repair and preserved sources

Lucide metadata is pinned to release commit
`91a1359b5ea235f620ba3a9682015ab8d6ada3af`. The upstream resolver expands
`$extends:` and `$group:` references before copying tags/categories. Preserve
all 2,159 accepted spellings, add 158 exported names and resolve 2,313 package
export keys from 2,317 saved spellings. Thirty old aliases and three newly
exported aliases map to canonical names without rewriting stored values.
Existing glyph equality, search deduplication, avatar URL round trips, local
synonyms and numeric-spelling controls remain. Explicit controls reject raw
metadata markers and preserve saved emoji presentation selectors exactly.

Only resolved metadata is shipped, with release provenance and notices; no
upstream resolver code or new dependency is added. The first metadata-helper
inspection lacked its type-only source module; extracting the actual upstream
module completed the audit without altering the helper. The first new marker
assertion also rejected legitimate currency `$` tags; it now targets only the
actual `$extends:` / `$group:` markers, retaining valid currency metadata.

Matched historical descendants change only root/package-lock and the print
workspace manifest. All eight dependency maps and the complete lock match the
candidate while original application behavior and three historical patchers stay
unchanged:

- Responsiveness `96ae9e0a07d113c5de771f6e4e0f4ae83fae812d`, parent
  `ae2885ede75a168711a712a837245bc7d61b0abc`.
- Callback `b75e3797a11ac2f53e3833b5615f68b6c0091727`, parent
  `2a49413a1d4d8841289412e311ddd237f522afa5`.

Lock SHA-256: `cdb5afd5811c7229c9b0c9ffd945a51848dd1c58b32051d1fb20d2842568177c`.
Its 66 changed package records are exactly the union of both bot sources.
Every Univer package record remains unchanged. CI references these immutable
historical sources; coverage routing, comparison algorithms and limits are intact.

## 🧪 Local checkpoint

Pinned Node 26.13.0 and the shared serial/process-tree watchdog own local work:
normal macOS pressure, one workload, at most 2 GiB RSS and eight minutes.

- Initial local install failed because integration had not yet copied #277's
  `lib/print/package.json` Vitest update. Including the complete bot diff repaired
  manifest/lock agreement; no lock regeneration or extra resolution was needed.
- Fresh normal installation and all five guarded postinstall patchers passed:
  5.440 s, peak 1,069,712 KiB.
- Profile/search/catalog/alias/emoji contracts: **94/94 passed**, 2.703 s,
  peak 510,192 KiB, after correcting the overbroad marker assertion above.
- Appearance persistence/authorization, public profile, MCP and native transport:
  **70/70 passed** in six files, 24.047 s, peak 1,017,696 KiB.
- Full lint, dependency-boundary and formatting checks passed: 11.744 s,
  peak 810,704 KiB.
- Historical comparison, dependency routing and fail-closed gate controls:
  **72/72 passed**, 1.480 s, peak 433,696 KiB.
- Bounded typecheck was resource-aborted at 5.020 s, peak 1,220,704 KiB, with
  no compiler diagnostic. This is not a passing typecheck; hosted CI must run it.

The bot's failed historical comparisons and original native Safari pointer
failure remain visible. Fresh aggregate CI and independent light/dark/phone
visual review are still required before merge; prior-source passes do not qualify
this candidate. No failed/selected worker is treated as inapplicable.

[Local attempt receipts](evidence/dependabot-2026-11-12/local-receipts.json) preserve
commands, successful outcomes and original failures/resource aborts.
