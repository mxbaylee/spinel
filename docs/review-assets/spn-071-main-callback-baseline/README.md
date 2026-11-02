# Main mobile callback baseline first failure

Main push CI 41438842560, job 125255691604, attempt 1; source 3233f9374c9dc028094f548b308a3f9dda3265ca. Historical baseline 0e1df4725d9eccb77574d25e3eecdf678fe6ff44.

The historical baseline timed out at the unchanged 420000 ms test limit. Its last persisted phase is typing; completion, observed input count, final content and callback analysis are unavailable. The underlying cause is unclassified. Failure screenshots may reflect timeout cleanup and do not establish the point of failure. Missing baseline error fields are not evidence of observed browser errors.

The main candidate completed and passed its behavior and callback bounds: 2086 observed keydowns, typing wall time 221539.188036 ms, no reported browser errors, callback caps 4/1/1 and zero callbacks/installations after disposal. The paired comparison correctly failed because its baseline is incomplete. Candidate success does not make this run pass. No retry or timing-budget relaxation was performed.

Original artifact 13140631129 SHA-256 f6c5677e2ba5b2125716c5d03d5db678fa85db9f14654f9e9f65244fa10e93ed is retained locally. This archive retains selected full JSON (losslessly gzipped), reports, failure captures and job log; disposable databases and source-map bundles are omitted.

This is a separate post-merge main failure, not SPN-098 acceptance evidence. SPN-098 must pass its own complete comparison. A separately scoped baseline investigation remains owed; SPN-120's finite historical inventory and SPN-130's desktop identity/storage scope do not cover this new callback timeout. Register the follow-up at the next backlog registration opportunity; do not silently discard it or infer a product defect without evidence.
