# 🔬 SPN-142 offline capability evidence

`native-caches.json.gz` losslessly retains the exact synthetic eight-cache fixture
from immutable archive `7bb40055401193c409e437fec220dccc70409a8b`, originally
captured at `cbb5b04473eed437f3a7bc877fcc6f31d5f04992`. Decompressed SHA-256 is
`714376723b3ef6a048796f7a1903a58181098960960cecb111e22e0594a2e7c8`.
It is reused by the existing Docs patch suite, not a new runtime capture. The
tagged representation preserves own undefined fields that ordinary JSON loses.

`probe.ts.gz` is the exact historical, diagnostic-only TypeScript probe, with its
original local paths; it is archival source, not a portable test entry point.
`results.json.gz` retains all320 cases, input/build/helper hashes and work counts.
The first log and watchdog preserve its one passing execution and resource scope.
Both admission reviews are nonimplementing agent reviews, not acceptance grades.

Only native clone/iterator calls are counted; guard costs, total allocations and
browser latency are not measured. State416/Enter mapping is source arithmetic,
not a cache/profile captured from the failed102.4ms interval. That failure and its
unknown inner cause remain preserved by the canonical implementation record.
