# SPN-111 helper-branch evidence preservation

The Owner requested branch cleanup while finishing SPN-111 on 2026-10-28.
The following evidence is copied byte-for-byte into maintained repository paths
before removing its helper branch. Original provenance remains inside each set;
copying evidence does not constitute a fresh test or change its reviewed source.

| Former helper branch | Source commit | Preserved destination |
| --- | --- | --- |
| `review/spn-111-7a7072d` | `62aa53e98641defb75b73b3e3b0a6a839c408fcc` | `docs/design/review/spn-111/application-7a7072d/` |
| `review/spn-111-fa4f3c4` | `6f38d29a382252e448ccde159d80cf5086c1d73c` | `docs/design/review/spn-111/application/` |
| `evidence/spn-118-native-flush-diagnostic-20261028` | `f258c9daef5176a17654c7f32a91a7f31e8e8b97` | `docs/implementation/evidence/SPN-118-mobile-blocker/` |

The superseded readiness proof is retained in
[SPN-111-offline-readiness-proof.zip](SPN-111-offline-readiness-proof.zip),
the complete diff from base `9017b74c35b5ea74fc31431acdeb976703d572b8`
to `d6e3d29fe719d9b2032cfb416c72bb18fda65724`. It is historical diagnostic
source, not an installed workflow. The smaller canonical SPN-116 guard remains
the product's acceptance fixture.

The production changes from `codex/spn-111-flush-repair` and
`codex/spn-111-flush-headroom` are already in SPN-111. Their temporary authoring
workflow is intentionally excluded. The older
`integration/spn-118-main-20261028` contains the same eleven SPN-118 source and
evidence files as active PR #213; its additional SPN-066/SPN-116 work is on main.
It contains no unique unfinished implementation. Recheck branch heads before
deleting any ref. Preserve the active SPN-105 and SPN-118 PR branches.
