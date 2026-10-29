# Desktop baseline startup failure

Application candidate: 9a0931cf9197bbf9d3022c511298bd9974d5f9c4.
Workflow run: 40805896981, attempt 2, job 123238011040.
Immutable baseline: 2c84a18449c7dae09e2817989fac6236be96ef98.
Artifact: 12870012519; archive SHA-256: 1ee4b03e282c1084064e8be6b5392894840365fc8c82f5ea323bdccf31ee8ce4.

The baseline server did not become ready within the configured 60000 ms. No baseline or candidate test reached execution. Logs also report a separate 3000 ms Git metadata fetch timeout. The exact startup cause is not established. The same baseline and candidate passed run 40805811875; one unchanged-source targeted retry is planned after the active run ends. No test assertion, startup timeout or required check was relaxed. This report preserves the failed attempt separately from any later retry.
