# ⬆️ Dependency integration and future update groups

## 🧭 Decision and scope

**2026-11-06 — accepted preparation policy, agent judgment under the owner's
explicit integration request.** Start from GitHub main
`f4b5c3f0740c46b00bd7d2d1fefb232edd7308a5`. Keep each dependency update and its
supporting repairs in separate preparation commits; the repository still lands
one squash commit after independent review and current-head acceptance.

Storybook **10.6.5** is the compatible remaining update from
[PR #242](https://github.com/mxbaylee/spinel/pull/242). Its existing React/Vite
integration satisfies installation with that core patch. Adopt the inspected
unmerged preparation `27c9e45974195cebdbcbec6da38e087fab0a2a10`, including the
[restore HTTP observer correction](SPN-115.md#restore-snapshot-observation-and-idle-connections).
That preparation had no hosted acceptance; its existence is not a pass.

Historical responsiveness source `6ee50161c9eeeb7296ffb282d7ae52abd9e61d1b` and
callback source `48dc8d4698129d5c7748ff2dac3b5d18cb0bcd6b` have byte-identical
lockfiles and matching dependency/devDependency maps with the candidate. Relative
to the preceding main baselines, only Storybook's manifest/lock entries change;
historical application behavior, workloads and comparison budgets remain intact.

### Updates excluded from this integration

- **Caddy #238**, head `ff0872497ad8a83856e77b4d404333f85a020117`: the first
  post-restore member boot in
  [run 41489208790 / job 125428711693](https://github.com/mxbaylee/spinel/actions/runs/41489208790/job/125428711693)
  displayed the generic startup failure. Its successful retry did not establish
  the rejected boot boundary or exception, and the first failure missed restored
  content/offline assertions. The fixture did not establish Caddy as the cause.
  Rebuilding its stale branch would fix PR bookkeeping, not this evidence gap.
  Next: retain a safe boot stage/exception class and first-attempt trace, prove the
  recorder against a deliberate rejection, and resolve the captured cause.
- **Univer #240**, head `8fc16ca5d7b3decd5ef4f470016d0353ae559e23`: the current
  [install job 128275085066](https://github.com/mxbaylee/spinel/actions/runs/42330159669/job/128275085066)
  rejects core 1.3.1 against `@spinel/presence-ui`'s exact 1.1.0 peer. Other
  workspaces also retain 1.1.0 peers. All five SDK patchers intentionally guard
  the old version/source hashes. Aligning a lockfile alone is insufficient.
  [PR #223 / SPN-099](https://github.com/mxbaylee/spinel/pull/223) removes the
  core patch while retaining 1.1.0; it is related prerequisite work, not a
  completed 1.3.1 migration. Peer alignment and each remaining patch's native
  behavior/acceptance must be addressed together.

Keep both excluded PRs open. Close a superseded update only after its actual
changes have landed.

## 🔬 Original sized-restore failure and bounded diagnostics

The original
[run 42329786250 / job 128273632235](https://github.com/mxbaylee/spinel/actions/runs/42329786250/job/128273632235)
tested main `f4b5c3f`, not the Storybook preparation. It reported
`restore-prep-planned-candidate-reconcile-memory-headroom`, with canonical
`preparation-planned` / `recovery-required`, a closed failure and no selected
candidate. The 256 MiB image workload used the unchanged **1,024 MiB / 0.75 CPU /
128 PID / no-swap** serving profile. Supervisor closure was clean and
`oomKilled:false`; the peak reaching 1,073,741,824 bytes does not establish an
OOM kill. The later memory snapshot is explicitly not the rejecting sample.

The complete original artifact, including safe source identities, timings,
memory snapshot and failure screenshot, is retained unchanged as
[sized-restore-main.zip](evidence/dependabot-2026-11-06/sized-restore-main.zip).
Original artifact ID: `13557600106`; ZIP SHA-256:
`31e07e4d135c658635413216aa5a152d97ec3fc9e61f102c675335ea159bba33`.

That evidence cannot distinguish start/running, host/cgroup pressure or raw-usage
fallback after missing/invalid/inconsistent cache counters. No behavioral repair
is claimed for those unknown historical conditions. The prior observer correction
concerns idle HTTP connections, a different mechanism.

The guard now emits one bounded numeric/categorical stderr record per refusal,
using its exact already-read values and computed decision. It preserves the
existing public error, journal and worker protocol. A failed diagnostic sink
cannot suppress or replace refusal. No raw kernel text, native message, path,
SQL or document material is emitted. The acceptance harness retains at most eight
validated observations from the existing 30-line/16-KiB stderr tail and explicitly
records collection failure/truncation. Observations retain timestamps and guard
phase; the last record is not automatically the canonical failure's cause.

The existing thresholds remain **640/128 MiB cgroup headroom** and **768/256 MiB
host availability** for start/running. Clean inactive disk-cache credit,
conservative fallback, the worker's RSS/heap/time bounds and all acceptance
assertions remain unchanged. A single first-attempt validation of this new
diagnostic candidate is justified to obtain discriminating evidence. A clean
result validates that candidate; it cannot reconstruct the old missing sample.

## 📦 Future Dependabot policy

Group minor/patch updates by Storybook, Vite/Vitest, React/types, TypeScript
tooling, lint/format tooling, WebAuthn, server transport/types, archives/types,
print/rendering and first-party GitHub Actions. Packages without a related
family stay individual. Every broader npm group explicitly excludes Univer.

Univer keeps its own coordinated minor/patch group and a separate coordinated
major group. Other major updates remain individual. Preserve the existing
dedicated Univer security group, including security fixes that require a major;
new ordinary groups apply only to version updates. No security ignore, security
cooldown, target-branch or repository security-setting change is introduced.
Grouping is an update proposal, not proof that peers or guarded patches support it.

All four ecosystems keep Monday **09:00 America/Los_Angeles**, npm's explicit
seven-day cooldown, its `increase` strategy and the literal `⬆️ Bump ` prefix.
The single-image Docker and Caddy Compose entries remain separate, including the
Caddy-only allowlist. Keep the root npm workspace entry and shared lockfile.

Syntax and behavior were checked against current official GitHub documentation:
[options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference),
[security grouping](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates),
and [grouping/cooldown guidance](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates).
Groups use the first matching rule, exclusions win, unmatched updates remain
individual, and ordinary cooldown does not postpone security remediation.

## 🧪 Verification contract and persona effects

The restore observer's Node tests prove preserved authenticated snapshots,
fresh-connection reset propagation and HTTP-failure rejection without retries.
Headroom controls prove unchanged boundary decisions, cache fallback and host
pressure, sink-failure containment and bounded sanitized collection. The existing
memory-guard cases remain applicable. Installation validates the combined lockfile;
strict types/lint/backlog/PR checks validate source and repository policy.

Dependency and workflow inputs retain broad automatic selection in
`scripts/ci/plan.ts`. The existing sized-restore predicate also selects the new
recorder controls; the `e2e/restore-` helper is already covered. No coverage,
retry, timeout, guard or budget is weakened. Hosted validation owns the complete selected matrix, first-attempt
sized restore, native comparisons, rendering/interactions and seven named gates.
Exact reviewed/tested source, run attempts, failures and final independent grades
belong in the integration PR acceptance record. Local checks are not hosted passes.

The Operator receives coherent update proposals and actionable, bounded refusal
evidence. The Owner and Collaborator retain the full restore/content/history
contracts. Link guest permissions are unaffected. There is no product UI change;
Storybook rendering/interaction checks remain required without inventing a new
visual design or requesting human approval.
