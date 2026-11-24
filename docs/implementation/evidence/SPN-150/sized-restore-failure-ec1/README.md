# 🔎 Retained sized-restore failure

CI run 45321337898, job 138200796495, artifact 14888166883 failed on the
pre-integration branding candidate. `summary.json` preserves the exact source,
limits, canonical failure and the bounded refusal observation. `evidence.json`
is the original machine-readable evidence; `failure.png` is its failure capture.
The ZIP digest was verified before extraction. The artifact expires 2026-12-08;
these retained bytes do not depend on that retention.

The recorded conservative memory-headroom refusal is consistent with the
failed acceptance but its bounded tail does not automatically attribute the
canonical failure. Review found the guarded restore/runtime paths unchanged;
no branding cause was demonstrated, and indirect timing/cache effects remain
possible. Budgets and guards stay unchanged. Full sized acceptance on the
final integrated head is required; this archive is failure evidence, not a pass.
