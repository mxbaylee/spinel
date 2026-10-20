# Presence rendering prototype

SPN-036 feasibility experiment. Uses public Univer 1.1.0 APIs for temporary
Sheet highlights and Doc text ranges, with a React icon/name label anchored to
the selection. No document formatting is changed. The host supplies selection,
colour and label, and owns authentication and transport.

This is not ready for production: body text and single Sheet ranges only.
Remote offsets are not transformed through concurrent edits. Reflow refreshes
geometry, but offset transformation, reconnect/expiry and multi-range/table/header
selections need verification and implementation before adoption.

The app opts in with `?presencePrototype=1`. It uses two sample appearances,
not persisted profile settings. Guest routes are excluded. Nothing is merged
or enabled by default by this experiment.
