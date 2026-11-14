# SPN-158 resumed local verification

## 🧪 Exact integrated source

Runtime tests, Typecheck and source quality checks ran on integrated source
`0e32180a77a22466e6bfaa9f4c2a1b6a5769a139`, a merge of prior candidate bfeb0b23
and actual main ecef3c6d. Index generation preceded that integration commit; backlog
validation followed the maintained-document updates and checked the same final
ticket/index bytes. The complete subsequent
candidate adds maintained evidence and documentation only. `source-identity.json`
proves all three maintenance source hashes unchanged from bfeb and identifies the
three accepted SPN-149 executable changes inherited from main.

`checks.json` inventories original receipts and compressed logs. Two focused HTTP
controls and full tuned Typecheck passed. Nine unrelated HTTP cases were filtered;
they are not new runtime skips. Native-Go tuning is tool-only640MiB/GOGC50/procs2.
The CLI regenerated the index; source lint/format, dependency boundary and backlog
checks passed. A receipt peak of0KiB means the short process finished before the
first200ms monitor sample, not zero resident memory. No resumed workload aborted.

Dependencies are read-only from the clean SPN-098 checkout after lock, six manifest
fields, all239 patch/workspace files and seven workspace links matched. Vitest
results caching was disabled and its module cache was task-private. The explicit
process/start-time/cwd audit found no owned survivor and killed no process.

## 🔎 Historical boundary and remaining acceptance

[Original failed hosted validation](https://github.com/mxbaylee/spinel/tree/0cadd4707e659fcc79b26f15ea9802fb7fd45e7f/docs/review-assets/spn-158-validation-bfeb0b23)
retains the passing actual Linux postcommit case and separate failed revocation
observer gate. SPN-149 subsequently landed; its integration changes the combined
source. That earlier failure does not become a pass, and the original503 cause
remains unproved. The prior detecting session-only mutation is retained under
`../spn-158-local/` rather than repeated unchanged.

The complete committed candidate requires two independent reviews, an exact-head
PR check, and all applicable current hosted acceptance before landing. Exact final
PR-check identity is retained outside this self-referential source commit for the
review packet and subsequent immutable validation record. No push or merge is
claimed by these local results.
