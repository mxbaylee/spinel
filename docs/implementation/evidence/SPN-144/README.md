# 🔬 SPN-144 local capability evidence

These gzip files retain exact original bytes under `manifest.json`; inspect with
`gzip -dc FILE.gz`. The first native capability probe **failed** because the
official converter accepted a truncated protobuf envelope. Scoped timer/source
subchecks passed, but are not full semantic fidelity or historical deadline proof.
The separate browserless outer-envelope guard passed on retained bytes and fixed
negative inputs; it explicitly does not validate opaque packet semantics or loss
of a complete final packet. No browser capture or converter was repeated.

The [canonical checkpoint](../../SPN-144.md#-capability-checkpoint-native-trace-format-and-external-conversion)
records prospective counts, budgets, source/script/binary identities, first failure,
independent review, limitations and the next missing evidence. All raw captured
JSON/proto and converted JSON bytes, fixture source, semantic records, command
outputs, scripts and watchdogs are retained here. The failed converter's partial
malformed-output file was removed as declared; its six-byte input and exit0 receipt
remain. Successful fixture cleanup is not successful capability acceptance.

The official native13,597,976-byte mac-arm64 binary is not vendored. Its pinned
version, immutable public manifest/download authority and SHA256 remain in the
canonical record/preflight source. Public upstream source is referenced by pinned
URLs; no modified upstream implementation is included. The preflight's version and
help output are retained, including the actual supported CLI arguments.

Registration main validation and its final-description-only cancelled run are
also retained. Four failed guards in that cancelled run remain failed and fully
explained; they are not runtime assertion failures. No unperformed or cancelled
work is credited as a pass. These receipts supplement registration PR264 and its
immutable registration archive without causing another PR body-edit loop.
