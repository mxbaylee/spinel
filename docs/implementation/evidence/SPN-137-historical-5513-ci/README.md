# 🧾 Historical source 5513 ordinary-CI preservation

This package preserves existing evidence for [CI run 41813499295](https://github.com/mxbaylee/spinel/actions/runs/41813499295), workflow attempt 1, completed successfully at 2026-11-04T10:45:53Z. It is historical ordinary-CI proof only for source **5513ccb247401006982f628d0bac827691d51533**. It is not acceptance for SPN-139 or a later combined SPN-137 source. Separate native run **41813499184** failed at Safari initial identity; ordinary-CI success does not alter that result.

## 🔗 Exact identities and scope

| Identity | Value |
| --- | --- |
| Source | `5513ccb247401006982f628d0bac827691d51533` |
| Original base | `5062129284ef7c60c1bc292edba130bab278c8ba` |
| Tested merge | `0cb4e715881a5f4948c25584e7d9d5336f984984` |
| Source/tested tree | `7b2388cb962187e487360e3b7c941796685efd3d` |
| Serialized plan SHA-256 | `bfd363a9b562fb18f83ddc3b752f531721d2201075ac20652b3131c5575b0100` |

The original Git-object records establish tested parents [base, source] in that order. The full plan selects all 15 suites for the `pull_request` / `synchronize` event with reason “Unknown paths require full coverage.” All three original aggregate reports retain the same complete plan and digest. Its serialized digest excludes the one terminal newline in the artifact file; the full member hash is preserved separately. The original derived receipt records the immutable 15-path diff comparison. No later current PR base or merge ref is substituted.

All **33 expected jobs passed**, including the classifier, the **seven required gates**, and all **25 selected worker jobs**. Each provider job is attributed to workflow attempt 1 and the exact source above. The browser aggregate reports `passed: true`, 12 successful selected suite results and successful Typecheck, Unit tests and Lib tests gate results. Unit and library aggregate reports also pass.

| Required gate | Job ID | Result |
| --- | ---: | --- |
| Backlog | 126518823907 | success |
| Pull request | 126518672697 | success |
| Lint | 126518823559 | success |
| Typecheck | 126518824822 | success |
| Unit tests | 126522904714 | success |
| Lib tests | 126523173681 | success |
| Playwright smoke | 126527785330 | success |

The selected workers comprise three unit partitions, four library partitions, 11 Playwright entries, container smoke, sized restore, retained sync transition, two responsiveness owners and two callback owners. The original logs retain the paired performance baseline/candidate/evidence steps and full phone-compatibility flag. Conditional skipped steps remain visible and are not counted as successful execution of those steps.

## 🔎 Skips, retries and evidence limits

The 11 browser workers report **449 passed and 10 skipped cases**: development 1/2 has three skips, development 2/2 one, production 1/2 three, and mobile HTTPS three. The remaining library partition reports **953 passed and three skipped cases**, two in `schema.test.ts` and one in `rule-based.test.ts`. All 13 skipped cases remain skipped. The full raw logs and original derived per-job summaries preserve the exact reported counts and other partitions; these selected figures are not presented as a universal total for all assertion systems.

Provider records report no failed, cancelled or timed-out job or step, and the prior complete-log inspection found no `Retry #`, positive failed/flaky summary or Actions error marker. **Workflow attempt 1 does not establish that every individual test used zero retries.** Per-test retry counts were not exhaustively audited from every scenario JSON archive. The pinned configuration retains CI retries and `failOnFlakyTests`; this package makes no universal retry-zero claim.

Large scenario, trace, image and performance archives were not downloaded or independently regraded in this historical collection. Original metadata for all 23 artifacts is preserved, with their actual IDs, digests and expiry. This package does not turn log summaries into complete scenario traces or grant acceptance to unexecuted/failed native obligations.

## 📦 Exact-byte contents

`records.json.gz` is standard gzip of a UTF-8 JSON envelope with schema `spinel-historical-ci-source-files-v1`. Its `files` array contains {path, bytes, sha256, encoding: "utf8", content}. Re-encoding each content string as UTF-8 restores its exact collected original bytes, including job-log BOMs and terminal newlines. Nothing is truncated, and no report fields, log lines or source fields are removed.

All **57 collected UTF-8 files** are included: the original plan and three aggregate members; all 33 complete job logs; seven provider/Git response records; five immutable source snapshots; and eight explicitly derived collection records (capture methods, four ZIP verifications, original README, receipt and manifest). Derived records are classified in the manifest and are not described as provider originals. Each input was rechecked against the original collection manifest, then every decoded envelope file was compared byte-for-byte with its source. The 60 original manifest entries include the four ZIPs; the manifest itself is additionally retained in the envelope.

The four small original ZIPs are supplementary container bytes, retained in the source collection, rather than embedded in this UTF-8 envelope. All of their original members are preserved in full here. Their provider byte counts/digests, CRC results, safe regular-path verification, member byte counts/hashes, creation timestamps and exact expiry remain in `manifest.json` and the original verification records:

| Artifact | ID | ZIP bytes | SHA-256 | Expires UTC |
| --- | ---: | ---: | --- | --- |
| ci-plan | 13313482379 | 1,181 | `3f111c2eaeedae41697f0f76d671f9a46916b8cf8131049a44cbced214ab02a3` | 2026-12-04T10:21:34Z |
| ci-results-unit | 13313717740 | 1,539 | `a1fe3f681e35b54f1b1b0cce592bbba0f55a96e7979d13a4e68f8c80e9a2b8b7` | 2026-12-04T10:32:41Z |
| ci-results-lib | 13314227143 | 1,557 | `b05035ea877def59d16a8ebe111e2b4cbf8b490c21509a0cda3fa22981dcca02` | 2026-12-04T10:33:25Z |
| ci-results-browser | 13313814503 | 1,764 | `4f8746ce73d7eff766cfa12b4fe539a89b7335b12d91b4fb88008061505b5f69` | 2026-12-04T10:45:50Z |

Run-level creation time is explicitly the original workflow creation, from the run metadata endpoint; the separately captured attempt response is retained unchanged. Provider JSON and logs are connector-returned UTF-8 saved with a terminal newline, not original HTTP response bytes. Source snapshots are the retained immutable Git-source text. The earlier downloader initially mislabeled absent transport exit statuses; those statuses were not retained, but all four completed ZIPs independently matched provider size/SHA, CRC and extracted-member checks. No download was repeated. That collection bookkeeping issue is not an execution failure.

## 🔐 Decoding and privacy

Decode with a standard gzip implementation; for example:

```sh
gzip -dc records.json.gz > records.json
```

Check the compressed and decoded lengths/SHA-256 against `manifest.json`, then encode each `files[i].content` as UTF-8 and check its listed length/SHA-256 before writing an extracted file. File paths are relative collection paths; use a new destination and reject absolute paths or parent traversal. This is a lossless source-file envelope, not a newly executed validation result.

Plaintext was checked before compression for unmasked tokens, private keys, API-secret patterns, JWTs and signed download URLs. No such matches were found; all 111 detected credential-value labels retain provider masking. No redaction or omission was used to hide credentials inside the encoding. Complete originals remain in the source collection for independent comparison.

Preparation only read existing evidence and wrote this scratch preservation package. It did not change a worktree, execute validation/native scenarios, create a commit, publish, rerun or cancel GitHub work.
