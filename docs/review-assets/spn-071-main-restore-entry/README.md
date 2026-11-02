# Main restore-entry failure after SPN-132, repaired in SPN-071

2026-11-02. Main push CI41429381396, job125224028303, source/tested
cc8364693791d981b86e80efc40bedba7fff2c08 failed during
authenticating-after-session-reset. Artifact13133184889 has ZIP SHA-256
93c6442f1dab4debe094de1808ab9c0210fc1e89a1959227ccd2d1a75402fc2c.
The complete original JSON, screenshot, ZIP and job log are retained here.

The restore itself reached committed/running and the original owner session
returned401. Browser traffic then records /sign-in200 followed by /admin404;
the captured page says Not found. Failure source is
e2e/restore-browser.acceptance.ts:1297:83, the passkey-button wait. Main's
preceding line explicitly navigates to /admin#health after verifying session
reset. Anonymous /admin intentionally returns404. Page errors were zero; the
fixture containers are confirmed absent and the supervisor exited0 without
OOM. The private volume was intentionally retained on this ephemeral runner
for failure diagnosis; do not describe this failed run as complete cleanup or
full restore acceptance. Its database is not included in this archive.

SPN-071 already contains the independently reviewed correction to enter through
public /sign-in, then perform the real passkey login and return to /admin#health.
All denial, rich/native/authority and cleanup assertions remain. The original
same-boundary failure was preserved earlier at8273a9efa9c7684ab5e1301d916dfc9f3e445473;
this is a new occurrence on main, not a new inferred cause or a blind retry.

Current SPN-071 source c51458573f3a2cf2f5ff3701cf27abfcfe035935, basecc836469,
tested merge3ddf9dcb01807ce23a78118a9a7c45f7fd164d14 passed its own sized restore:
CI41430568768, job125227938948, artifact13134023824 ZIP SHA-256
1230839adec3e476ccd14ddc41c0264b9b70f4d8236458f6ef959bc54a8dc262.
It completed in284205ms, with zero page errors, rich content/history, native
rendering/copy, retained viewer and revoked/guest/write-denial checks passing.
Its private volume was removed and supervisor/cold helpers exited0 withoutOOM.
Passing JSON/ZIP and the exact source diff are included alongside the failure.
The full current SPN-071 workflow remains independently required; this one job
does not constitute final merge acceptance. SPN-132's two premerge full runs
remain accurately recorded passes, without implying this main-push run passed.
