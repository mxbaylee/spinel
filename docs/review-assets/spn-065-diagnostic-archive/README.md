# SPN-065 retained failure and partial diagnostic

This immutable archive retains both original downloaded GitHub artifacts byte for byte,
their SHA-256 hashes, a concise machine-readable summary and the diagnostic helper
source in its parent commit. Synthetic fixtures only. See `summary.json` for exact
run, job, source, tested-merge and artifact identities.

The original ordinary first-attempt idle-flush breach remains unexplained. The guard
removes measured duplicate status work; these samples do not establish its causal
relationship to that breach. All three diagnostic tests failed at trace export after
completing scenario correctness and applicable numerical assertions. No idle flush
was captured. No browser trace was retained. CPU profiles contain negative deltas
and cannot support precise temporal attribution. These are diagnostic observations,
not acceptance results, and no retry replaced the original failed sample.

- `original-unprofiled-failure.zip`: run 41384628382, artifact 13115832562.
- `partial-matched-diagnostic.zip`: run 41388902239, artifact 13115739733.

Do not merge this helper/archive branch into application code. The archive tag and
commit preserve evidence after helper refs and hosted artifacts expire.
