# @spinel/diagnostics

Private, standalone optional observation contract. No Spinel imports, network,
database, clock, logger or dependency. Call `observe(sink, event, context)` around
an operation; omitting a sink changes nothing and a broken sink cannot fail edits.
Pure transformations remain deterministic and do not perform I/O.

`DiagnosticEvent` is a registry, not an arbitrary JSON logger. Add a reviewed
event name and strict validator together. Logs have six explicit levels and
static messages; reason/operation/job codes are allowlists. Metric observations
fix their kind and unit per name: counters are **increments**, gauges are point
observations, histograms are raw duration observations. No percentile rollups are
implied. Finite nonnegative values only, integral counts.

Context permits opaque UUID file/Space/run IDs and registered route templates.
It never accepts actor identity, document names, contents, formulas, URLs,
credentials, error objects or arbitrary message text. Server adapters derive
identity and verify current file access. Browser records remain untrusted claims.
Adapters add event IDs, timestamps and bounded delivery; these are separate from
document edit reliability. A queue must never relabel an old event after a clear.

The package exports validation and the optional sink from `index.ts`. Tests cover
schema privacy boundaries, metric semantics and failure isolation. Run through
the repository's unit tests; this package is not yet published.
