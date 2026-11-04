# 🖱️ SPN-137 blocked validation checkpoint

Source `6c0080d5aa492e654a225b4d22073f0d251cfb4d`, base
`77cdd6c556c186cb5705b4d24e312da3aea36d3e`, tested merge
`1ef685c0cb9b8f613806496356fa4167cb88dbdc`.
This archive is evidence only; it does not change the reviewed PR source.

## 🔎 First native sample

Run **41781852610**, attempt **1**:

- Safari job **126414974164**, Safari **27.2**, macOS **15.7.9** Intel,
  image **20260824.0482.1**, failed in the unchanged profile capability probe.
  The eight-second identity request lasted **8,022 ms**, terminating with
  SIGTERM after `appkit-import-begin` and before `appkit-import-end`.
  No owned identity was established. Fixture teardown correctly refused the
  unknown identity; subsequent runner orphan cleanup is not fixture-owned
  teardown. Pointer/application/content/reconnect/storage-loss acceptance did
  not execute. The screenshot shows only the synthetic profile-probe page.
- Chrome job **126414974479** and Firefox job **126414974508** passed complete
  native offline acceptance on macOS 26 arm64 image **20261026.0455.2**. Their
  raw acceptance and versions reports retain exact content/images, reconnect,
  conflict-copy, storage-loss and three owned browser/driver exits each.

The recurring AppKit-import boundary is separate from the SPN-137 pointer
scope and has SPN-130 provenance. Its phase is known; its root cause and a safe
transient classification are not. Reviewer A found no evidence-backed in-scope
repair or justified rerun. Sample 2 remains unused, reserved for a concrete
reviewed repair. No scenario, host, timeout or ownership check was bypassed.

Original artifact digests (ZIP bytes):

- Safari **13299611894**: `8d400dccbac5b57caed086775a6c28ecf40bc3236e1dc0298695d06025f9f907`
- Chrome **13299054136**: `9935fbefa2aed8d97ab7771809feefc5de981703e804c535027d37392548c3b7`
- Firefox **13300050070**: `090e782e83b02b1ba93be7cb95495b775bbe8a87203716293c4880c6c0fdc7a4`

Raw Safari probe, versions, screenshot and complete job log are retained here.
The log is decoded from the connector with ANSI color escapes removed.
Successful Chrome/Firefox acceptance and version reports are retained; their
other screenshots remain supplementary Actions artifacts expiring 2026-11-18.
`manifest.json` binds the archived files, independently of those original ZIPs.

## 🧪 Local review and CI

All 72 local controls, scoped strict TypeScript/Oxlint/format/backlog/PR checks
passed; exact commands and outputs are retained. Both independent reviewers
graded the exact source 98/100, agent review only, with hosted evidence pending.
Reviewer B independently passed all 28 pointer controls under the shared serial
lock and memory watchdog. See `reviews.json` and the local/watchdog reports.

`ci-jobs-checkpoint.json` is an **in-progress**, complete paginated snapshot of
CI run **41781852668**, not a final pass. Backlog, Pull request, Lint and Typecheck
had passed; Unit tests, Lib tests and Playwright smoke aggregates were still
pending. Storybook run **41781856618** was also pending. The PR remains draft;
the Safari prerequisite blocks merging regardless of later CI results.

## ⏭️ Resume

First diagnose the recurring identity prerequisite under newly allocated scope
with SPN-130 provenance; do not reuse its completed ID or silently expand pointer
work. Then integrate the reviewed repair, revalidate both source reviews and
complete the remaining declared native sample plus all seven current-head CI
gates. Ticket deletion on this branch is provisional landing bookkeeping.
