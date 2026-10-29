# Preserved final native acceptance — 2026-10-29

This collection preserves the original final desktop/mobile acceptance artifacts for [SPN-113 / PR #208](https://github.com/mxbaylee/spinel/pull/208#issuecomment-6463174753) and [SPN-121 / PR #216](https://github.com/mxbaylee/spinel/pull/216#issuecomment-6500002404). It adds no browser execution, new acceptance grade or new performance claim. The [consolidated final-acceptance record](../grooming-2026-10-29-final-acceptance.md) supplies the measured outcomes, original review limits and failure dispositions.

All eight downloaded original ZIPs were checked against the SHA-256 digests from those final acceptance records. The [manifest](manifest.json) records each original artifact's ID, URL, size and digest; PR source, executed synthetic merge, tree, baseline, workflow run and attempt; preserved ZIP size/digest; and **every original member's uncompressed size and SHA-256**, with its retained location or explicit exclusion reason. The original records confirm source/runner identity and attempt zero for each preserved typing/callback sample. Their comparison outcomes are preserved as historical data.

## Retained archives

| Preserved file | Original Actions artifact | ZIP bytes | Original members retained / omitted |
| --- | --- | ---: | ---: |
| [pr-208-desktop-responsiveness.zip](pr-208-desktop-responsiveness.zip) | [12798055417](https://github.com/mxbaylee/spinel/actions/runs/40644700239/artifacts/12798055417) | 1,360,356 | 18 / 0 |
| [pr-208-mobile-responsiveness.zip](pr-208-mobile-responsiveness.zip) | [12798522130](https://github.com/mxbaylee/spinel/actions/runs/40644700239/artifacts/12798522130) | 2,428,942 | 18 / 0 |
| [pr-208-desktop-callback-json.zip](pr-208-desktop-callback-json.zip) | [12797064706](https://github.com/mxbaylee/spinel/actions/runs/40644700239/artifacts/12797064706) | 2,405,333 | 5 / 80 |
| [pr-208-mobile-callback-json.zip](pr-208-mobile-callback-json.zip) | [12797491517](https://github.com/mxbaylee/spinel/actions/runs/40644700239/artifacts/12797491517) | 2,329,231 | 5 / 80 |
| [pr-216-desktop-responsiveness.zip](pr-216-desktop-responsiveness.zip) | [12906280161](https://github.com/mxbaylee/spinel/actions/runs/40889770563/artifacts/12906280161) | 1,473,276 | 18 / 0 |
| [pr-216-mobile-responsiveness.zip](pr-216-mobile-responsiveness.zip) | [12905448934](https://github.com/mxbaylee/spinel/actions/runs/40889770563/artifacts/12905448934) | 2,242,369 | 18 / 0 |
| [pr-216-desktop-callback-json.zip](pr-216-desktop-callback-json.zip) | [12903424766](https://github.com/mxbaylee/spinel/actions/runs/40889770563/artifacts/12903424766) | 2,218,608 | 5 / 82 |
| [pr-216-mobile-callback-json.zip](pr-216-mobile-callback-json.zip) | [12905221683](https://github.com/mxbaylee/spinel/actions/runs/40889770563/artifacts/12905221683) | 2,199,452 | 5 / 82 |

The preserved ZIPs total **16,657,567 bytes**. Their eight original ZIPs total **354,681,834 bytes**. All **416 original members** are inventoried: **92 retained**, **324 explicitly omitted**.

### Responsiveness: complete original ZIPs

The four `responsiveness.zip` files are **byte-identical copies** of their original Actions ZIPs, renamed for clarity. Each retains all 18 members: 16 JSON records/reports/comparisons and both CPU profiles. These include all baseline/candidate plain and profiled metrics, input/frame observations, native flush/drain/history/integrity evidence, post-burst and boundary records, profile clocks and original Playwright reports. The exact byte hashes of the complete original ZIP and preserved ZIP are equal.

### Callbacks: every JSON member, unchanged

Each `callback-json.zip` retains **all five original `.json` members byte-for-byte**, at their original member paths:

- Baseline and candidate `spn113-evidence.json`, including full derived timer ledgers, lifecycle markers, family accounting, source attribution and raw-file hashes, input observations, exact native text/caret, native behavior and completion status.
- Baseline and candidate Playwright reports, retaining first-attempt outcomes and the original CI/Git provenance.
- The complete original `spn113-comparison-desktop.json` or `spn113-comparison-mobile.json`.

Only the ZIP packaging changes: sorted member paths, a fixed 1980-01-01 timestamp, fixed file permissions, empty extra/comment fields and DEFLATE level 9. The manifest records the Python/zlib implementation for reproducing compressed ZIP bytes. Uncompressed member hashes do not depend on the compression implementation. A second in-memory packaging pass verified deterministic ZIP hashes, and retained member bytes were rechecked against the originals.

**The full callback raw traces are not preserved in this codebase.** The eight `spn113-trace.json.gz` members, compiled JavaScript/source maps and synthetic fixture SQLite/WAL/shared-memory files remain supplementary members of their original Actions ZIPs, subject to the workflow's **seven-day retention**. Each omitted file still has an original path, byte count, SHA-256 and exclusion reason in the manifest. Preserving derived JSON reports does not preserve the complete raw streams or compiled attribution inputs. The JSON keeps original references to these files; those references are provenance, not a claim that the omitted files are available locally.

## Read and verify without running the app

From the repository root, this checks each preserved ZIP and every retained member against the manifest. It writes nothing and does not start a browser, server or test suite:

```bash
python3 - <<'PY_VERIFY'
from pathlib import Path
import hashlib, json, zipfile

root = Path('docs/implementation/evidence/grooming-2026-10-29-native')
manifest = json.loads((root / 'manifest.json').read_text())
for artifact in manifest['artifacts']:
    archive = artifact['preserved_archive']
    path = root / archive['path']
    with path.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == archive['sha256']
    assert path.stat().st_size == archive['bytes']
    retained = [m for m in artifact['members'] if 'retained' in m]
    with zipfile.ZipFile(path) as zipped:
        assert sorted(zipped.namelist()) == sorted(m['retained']['member'] for m in retained)
        for member in retained:
            data = zipped.read(member['retained']['member'])
            assert len(data) == member['bytes']
            assert hashlib.sha256(data).hexdigest() == member['sha256']
    print(archive['path'], 'verified', len(retained), 'members')
PY_VERIFY
```

The original `test-results/spn108-comparison-*.json` and `test-results/spn113-comparison-*.json` members provide readable historical comparison results. The two Playwright reports in each archive distinguish baseline from candidate and retain actual test outcomes. The source in an executed metrics record is the **synthetic test merge**, not the PR source or eventual squash; all three identities are recorded in the manifest. PR #208 used workflow `40644700239`, attempt 1, executed merge `eb262b9e36f3759b5bfb0945e1e708f60828beaa`; PR #216 used workflow `40889770563`, attempt 1, executed merge `9259bd7467b2f42d256e24534a884f033b054491`.

## Recompute and understand the limits

For responsiveness, the complete retained inputs support re-running the original arithmetic comparator. First verify and extract the archive from the grooming checkout. Then use a separate disposable checkout of the matching original reviewed tree, its dependency lockfile and pinned Node 26.12.1, verifying the recorded harness hashes. For example:

```bash
# In the grooming checkout:
python3 -m zipfile -e docs/implementation/evidence/grooming-2026-10-29-native/pr-208-desktop-responsiveness.zip /tmp/spinel-pr208-desktop
# In the matching original source checkout:
node scripts/ci/doc-responsiveness.ts desktop /tmp/spinel-pr208-desktop/baseline-doc-source/test-results/doc-responsiveness /tmp/spinel-pr208-desktop/test-results/doc-responsiveness /tmp/spinel-pr208-desktop/recomputed-comparison.json
```

Extraction and the comparison output belong in scratch space. Substitute the corresponding archive and preset for the other three pairs. This recomputes comparison arithmetic from the original inputs; it does not reproduce the physical execution or convert profiled timings into primary acceptance. Keep the original comparison JSON alongside any recomputation.

For callbacks, the retained evidence JSON supports inspecting the full **derived** lifetime ledger, recomputing ledger summaries/input distributions and checking the original reported bounds, cleanup and comparison. Re-deriving the ledger from Chrome events and independently rechecking compiled source attribution requires the omitted raw trace and source/map members. To run the original full `scripts/ci/doc-callback-comparison.ts` CLI, obtain the original complete ZIP while available, verify its original manifest digest, extract it, and use the exact recorded executed-merge checkout and original command arguments (`<desktop|mobile> <baseline-root> <candidate-root> <output.json>`). Its source-identity checks are intentional. The compact JSON archive alone cannot satisfy the full raw-file verifier; missing supplementary files are a preservation limit, not a new application test result.

No result here establishes physical-phone or physical-IME coverage, identifies the cause of older unprofiled pauses, measures retained heap ownership, or attributes every cross-run timing difference to one fix. The original workload, source, baseline, environment and review qualifications remain authoritative.

## Data review

The preservation review parsed **84 JSON records and eight CPU profiles**, inspected fixture/record shapes and scanned string values and nonempty credential/account field paths without printing full record contents. It found fixed synthetic `Typing benchmark owner` / `Typing benchmark collaborator` fixtures, the registered 16-paragraph text and localhost test endpoints. The email fields are source Git author/committer metadata on GitHub domains. No unexpected actual application-user data or credential marker was identified; the manifest records the bounded checks and result. No retained member was redacted or rewritten. The omitted SQLite files contain synthetic fixture state and are not needed to read the retained JSON acceptance evidence.
