# Native paired-flush first failures after SPN-132

## SPN-098 current desktop failure

CI 41440026607, job125260142761, attempt1, source24e00a783803749b73483457b923dddafee9996c, base3233f9374c9dc028094f548b308a3f9dda3265ca, tested dbbe5ccaf085ce20b79068d3596a35dcf2142223. Artifact13139319830 SHA256 b16d3244ea9158bf89a55a4f288d7faae8efe2de1a76b92c53b5882c06fc88c4.

Candidate plain-2 attempt0 failed idle-flush p95: 34.300000000046566 ms >16 ms. It contains one observed idle flush. Other timing budgets, exact content and Undo/Redo passed; errors/reloads are empty. Its final completed marker is absent because the assertion failed. The complete candidate report has6passes/1failure, no retries or flaky pass. Other plain maxima22.8/14.1 ms and diagnostic profile13.6 ms do not substitute for the failed sample. Paired comparison JSON is absent because the candidate step failed first.

## Main mobile failure

Main push CI41438842560, job125255691327, attempt1, source3233f9374c9dc028094f548b308a3f9dda3265ca. Artifact13141157911 SHA256 8308adf82faadb01a7ab7a9e203c21ce18815ab4cdafd4baf6953dc5029727d1.

Candidate plain-1 attempt0 failed flush maximum:101.89999999990687 ms >100 ms. Exact content and Undo/Redo passed; remaining plain samples34.4/35.8 ms and profile41 ms do not override the failure. Historical baseline completed its four intended observations. Candidate report6passes/1failure.

## Disposition

Both original ZIPs preserve full native metrics, diagnostic CPU profiles, reports, failure images and error contexts. Both full job logs are retained. No assertion retry, forced GC, larger budget, workload change or reclassification as passing was used. A temporary local inspection helper initially failed because it expected a comparison JSON that the failed job never created; that is an inspection-assumption error, not an additional product test.

The underlying causes and any relation to SPN-098 remain unclassified. These native performance failures require separately scoped diagnosis/repair; SPN-098 stays draft and unmerged until fresh required acceptance succeeds after a justified change. SPN-132's specific composer marker repair is not proof that all native timing failures are solved. Main's separate historical mobile callback timeout is archived at d46f15908bc8eabe1c2f121353c0f768862e92f0/docs/review-assets/spn-071-main-callback-baseline.
