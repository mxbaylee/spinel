# 🧾 SPN-090 original production browser failure

Source 724b577791273e0962ff08a38dea77a5aa632d84, base c525aa933505d6e78b8fdd7a89940d87506d5cb3,
tested merge 6c28675d5fb1cc2d0a0a695413f95967b568ee40. CI 43626186157 attempt 1,
production 2/2 job 132542712402: 86 passed, 1 failed, 1 flaky. No workflow rerun was requested.
The workflow's already-configured test retries are preserved separately.

The new ready-guest case timed out at 30 s on original attempt and retries 1/2; its
other four production startup cases passed without retries. First/retry contexts
and screenshots show a ready empty Space, while the test awaits its page.route
application-request signal. The original retry trace records the application
first fetched by a serviceWorkerRef and then the frame receiving 200. This supports
a production interception-fixture gap, not an established guest completion defect.

The existing supervised-maintenance case failed first at maintenance.spec.ts:244:
Pause edits was not found. Its first context remains on Invites; configured retry 1
passed. AdminInvites sets the new link before awaiting refresh and clearing busy;
AdminPage deliberately rejects hash navigation while busy. This supports premature
fixture navigation, not a proven authority/admission failure. The flaky result
remains an acceptance blocker; no retry or unrelated pass waives it.

Both exact native offline content regressions and installation-resource case
passed in this same failed job, with their own attempt/duration records. The full
reporter remains authoritative; selected-cases.json is a useful projection.
The checkpoint is partial: remaining original jobs are named in checkpoint/summary.
Storybook and native desktop had completed successfully. No all-terminal or merge
acceptance is claimed by this first-failure archive.

The complete original artifact 14126254707.zip was downloaded and its SHA256 matched
GitHub: 7eff15bc5d95abb5074f1b268450a73fe4229e0b14aa064aeb86658ee9fad00a.
Its full local ZIP is retained privately. This compact record keeps original full
reporter, both retained retry traces, all failure contexts and the startup attempt
screenshots; unrelated successful maintenance screenshots are omitted. Original
trace/reporter data includes only synthetic localhost fixture account/invite data,
not actual user documents or live deployment credentials. Fixtures were disposed;
publication still requires manager content/hash review. No private databases or
browser profiles are included.

Original source remains available in the parent commit, including main/runtime,
GuestApp, AdminInvites/AdminPage and both test owners. No source mutation is part
of this archive. The separate observer issues (Python3.9 file_digest unavailable
and gh ANSI-log output refusal) were collector issues only, not product/CI results;
raw bytes were subsequently collected with compatible streaming hashes and the
explicit escape-preserving flag. Neither required a workflow rerun.
