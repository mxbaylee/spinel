# Bounded PDF feasibility probes

Run from the repository root with Node 24 and its locked development dependencies.
These synthetic probes do not accept production documents, credentials or URLs.
They are evidence for [SPN-097](../../docs/implementation/SPN-097.md), not an export
implementation. No packages need installing beyond the repository dependencies.

`guard.ts` retains the session's macOS workload guard: it refuses elevated memory
pressure, samples the child process tree every 300 ms and terminates it on elevated
pressure or RSS above 2 GiB. Run only one workload at a time. Exit 75 means deferred
or aborted, not success. Short jobs can finish between samples (a reported 0 MiB
is not actual zero usage); fixture metrics also record process maximum RSS. This
guard is a development safeguard, not production admission or memory accounting.
Other operating systems need an equivalent process-group/memory-pressure guard.

```sh
node scripts/pdf-feasibility/guard.ts node scripts/pdf-feasibility/native.ts
node scripts/pdf-feasibility/guard.ts node scripts/pdf-feasibility/sheets.ts
node scripts/pdf-feasibility/guard.ts node scripts/pdf-feasibility/inspect.ts
node scripts/pdf-feasibility/guard.ts pdftoppm -scale-to 1100 -png output/pdf/spn-097/native-doc.pdf output/pdf/spn-097/native-doc
node scripts/pdf-feasibility/guard.ts pdftoppm -scale-to 1100 -png output/pdf/spn-097/native-sheet.pdf output/pdf/spn-097/native-sheet
node scripts/pdf-feasibility/guard.ts pdfinfo -f 1 -l 5 output/pdf/spn-097/native-doc.pdf
node scripts/pdf-feasibility/guard.ts pdfinfo -f 1 -l 3 output/pdf/spn-097/native-sheet.pdf
```

Poppler must be on PATH; the recorded run used the bundled `pdftoppm`/`pdfinfo` in
`~/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/`.
The original session invoked identical guard source from `/tmp/spinel-guard-092.ts`.
Open every generated PNG after the assertions pass: text extraction alone cannot
prove image presence, correct colors, unclipped borders or readable layout.

The bundled `src/ui/fonts/AtkinsonHyperlegible-Bold.ttf` is registered globally as
`Probe` within each process. All text is deliberately bold; the probe establishes
no regular/italic, Unicode or system-fallback fidelity. Native library/build and
font differences can change layout, timing and PDF bytes. Compare structure and
rendered content, not byte hashes or timing thresholds.

Each generation script removes its previous named PDF after argument validation,
then publishes only after its layout/render loop succeeds. These negative probes
must exit 1, with failure metrics and **no PDF** in the separate rejected folder:

The rejected runs use byte-identical fixture JSON to the retained successful
inputs above. Their regenerated duplicate inputs are ignored in that directory;
the distinct failure metrics are retained.

```sh
node scripts/pdf-feasibility/guard.ts node scripts/pdf-feasibility/native.ts output/pdf/spn-097/rejected --page-cap=1
node scripts/pdf-feasibility/guard.ts node scripts/pdf-feasibility/sheets.ts output/pdf/spn-097/rejected --page-cap=1
```

The cap is checked after skeleton layout, so it prevents publishing a partial PDF
but does not bound layout allocation. No oversized-input or resource-kill behavior
is claimed. If the outer guard refuses to start, earlier output files remain;
if it kills a run, disregard all that run's artifacts, including potentially
interrupted writes. Use a fresh output directory when evaluating a failure. The
production slices require atomic publication, cleanup and process termination
before releasing admission; these demonstration scripts are not that boundary.
