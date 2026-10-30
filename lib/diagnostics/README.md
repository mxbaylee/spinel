# @spinel/diagnostics

Private, standalone optional observation contract. No Spinel imports, network,
database, clock, logger or dependency. Call `observe(sink, event, context)` around
an operation; omitting a sink changes nothing and a broken sink cannot fail edits.
Pure transformations remain deterministic and do not perform I/O.

`DiagnosticEvent` is a registry, not an arbitrary JSON logger. Add a reviewed
event name and strict validator together. Logs have six explicit levels and
static messages; reason/operation/job codes are allowlists. Metric observations
fix their kind and unit per name: counters are **increments**, gauges are point
observations, histograms are raw duration or integral count observations. No percentile rollups are
implied. Finite nonnegative values only, integral counts.

Context permits opaque UUID file/Space/run IDs and registered route templates.
It never accepts actor identity, document names, contents, formulas, URLs,
credentials, error objects or arbitrary message text. Server adapters derive
identity and verify current file access. Browser records remain untrusted claims.
Adapters add event IDs, timestamps and bounded delivery; these are separate from
document edit reliability. A queue must never relabel an old event after a clear.

The package exports validation and the optional sink from `index.ts`. Tests cover
schema privacy boundaries, metric semantics and failure isolation. CI runs them
in the Lib tests job with the rest of `lib/`; this package is not yet published.

## Sync observations

`observeSync(sink, context, observation)` records a registered sync metric. A
metric that also warrants a log emits a separate `<metric-name>.log` event with
its fixed level and static message. Refusal reasons, malformed checks, invariant
codes and drop rules are allowlists. Mutation labels match the supported
sync-transform vocabulary; unknown sender strings become `other`. The registry
rejects unknown detail fields and arbitrary error messages even for custom sinks.

The transform library's optional observer carries only drop-rule/count, candidate
offset/count and peak-growth/count observations. It performs no I/O; caller timing,
concurrent length, refusals, invariant failures and divergence belong at the server
boundary. The six loss rules are registered with their content-free validators.
The caller supplies already-authorized file/Space context and preserves the existing
exclusion of guest telemetry. No refusal or divergence payload shapes are collected.

`sync.edit.offset` is a count of writes alongside a clipped shift band. The wider
original command band is absent from the mutation, so the count is an upper bound
on actual offset writes. It contains no coordinates, values, ranges or dimensions.
Browser adapters emit registered resync/pending-loss observations at the native
recovery handoff. The strict client registry also defines connection/queue/receipt,
flush/checkpoint and offline outcomes. Local durable saving and server
acknowledgment use distinct operation names; a skipped or offline hook cannot
claim a server success. Server-only maintenance, history, publication and runtime
events have their own strict validator and are not browser-admissible.

The browser adapter samples complete routine success/skip bundles by fixed
families every 30 seconds; failures/cancellations bypass routine sampling but
retain hard collection limits. Counters describe retained observations, not
unsampled operation totals. A 429 discards the old queue and permits one fresh
verification after a minute, cancelled by lifecycle suspension. See the canonical
inventory for grouping, budget, loss and attribution semantics.

Spinel maintains the actual production boundaries and regression owners in
[`docs/diagnostics.md`](../../docs/diagnostics.md#emitter-maintenance-inventory).
Update that inventory when changing an observed operation; fixed registry names
alone do not establish production coverage.
