# SPN-111 helper-branch evidence preservation

The Owner requested branch cleanup while finishing SPN-111 on 2026-10-28.
Evidence from each helper branch is either kept in this repository or linked at
a commit that GitHub retains as the head of [PR #206](https://github.com/mxbaylee/spinel/pull/206)
(`refs/pull/206/head` history), so deleting the branch loses nothing. Linking
evidence does not constitute a fresh test or change its reviewed source.

| Former helper branch | Source commit | Where the evidence lives now |
| --- | --- | --- |
| `review/spn-111-fa4f3c4` | `6f38d29a382252e448ccde159d80cf5086c1d73c` | Kept: `docs/design/review/spn-111/application/` (the approved gallery) |
| `review/spn-111-7a7072d` | `62aa53e98641defb75b73b3e3b0a6a839c408fcc` | Linked: [`application-7a7072d/` at `a6ac90f`](https://github.com/mxbaylee/spinel/tree/a6ac90fbbc6f93e2e923e56230eaa5ff3bf24b1c/docs/design/review/spn-111/application-7a7072d) |
| `evidence/spn-118-native-flush-diagnostic-20261028` | `f258c9daef5176a17654c7f32a91a7f31e8e8b97` | Linked: [`SPN-118-mobile-blocker/` at `a6ac90f`](https://github.com/mxbaylee/spinel/tree/a6ac90fbbc6f93e2e923e56230eaa5ff3bf24b1c/docs/implementation/evidence/SPN-118-mobile-blocker), referenced from [SPN-121](../SPN-121.md) |

The superseded readiness proof is retained in
[SPN-111-offline-readiness-proof.zip](SPN-111-offline-readiness-proof.zip),
the complete diff from base `9017b74c35b5ea74fc31431acdeb976703d572b8`
to `d6e3d29fe719d9b2032cfb416c72bb18fda65724`. It is historical diagnostic
source, not an installed workflow. The smaller canonical SPN-116 guard remains
the product's acceptance fixture.

`codex/spn-111-flush-repair` and `codex/spn-111-flush-headroom` carried the
32 → 24 doc-history flush-cap change. That change was reverted before landing
([SPN-121](../SPN-121.md) owns the investigation); their commits remain in the
PR history. The older `integration/spn-118-main-20261028` has eleven SPN-118
source/evidence changes retained in active PR #213: eight files are byte-identical;
`docs/development.md`, `scripts/sync-transition/README.md` and `server/database.ts`
retain the same SPN-118 changes with later main/SPN-111 integration. Its additional
SPN-066/SPN-116 work is on main. It contains no unique unfinished
implementation. Recheck branch heads before deleting any ref. Preserve the
active SPN-105 and SPN-118 PR branches.

## Grooming preservation — 2026-10-29

The final SPN-111 gallery, manifests and baseline-startup failure evidence from
`codex/spn-111-review-9a0931c` at
`85fd49b5ab7ac37c35dc234ea9b4bc5223622d84` are now kept byte-for-byte in
[`docs/design/review/spn-111/final-9a0931c/`](../../design/review/spn-111/final-9a0931c/README.md).
This preserves the evidence before deleting the helper. It is the historical
capture of source `9a0931cf9197bbf9d3022c511298bd9974d5f9c4`, not a new capture.

The inventory still found the following obsolete refs, whose heads must be
rechecked immediately before deletion:

| Branch | Reviewed head | Disposition |
| --- | --- | --- |
| `codex/spn-111-review-9a0931c` | `85fd49b5ab7ac37c35dc234ea9b4bc5223622d84` | Final gallery/diagnostics preserved above. |
| `evidence/spn-118-native-flush-diagnostic-20261028` | `f258c9daef5176a17654c7f32a91a7f31e8e8b97` | Diagnostic content is byte-identical to the retained PR #206 history linked above. |
| `integration/spn-118-main-20261028` | `8befcbf96123cbf10f8e8304ebe9d88dd671ef06` | All eleven SPN-118 source/evidence changes are retained in active PR #213: eight files are byte-identical, three include later main integration; additional prerequisite work is already on main. |

The grooming session's Git push deletion attempt could not authenticate. The
connected GitHub API supports the PR/merge operations but exposes no ref-deletion
operation, and the browser session is signed out. This is an access limitation,
not a successful deletion. The grooming PR records the final live-ref result.
Preserve active PR #212/SPN-105, #213/SPN-118 and #217/SPN-112 branches. Future
cleanup must recheck this inventory rather than treating old heads as a lease.
