# SPN-063: recurring backup verification

Captured on 2026-10-27 by `e2e/backups.spec.ts` against the production app built
from this PR's implementation. The test uses a real filesystem destination,
scheduled encrypted publication, an isolated restore worker and a real CLI check
after corrupting the published archive. These are application captures, not
mocked status images. Fixtures contain no user data or credentials.

The light and dark captures use a 1440 × 1000 viewport. Phone captures use a
390 × 1000 light viewport. Each image is cropped to the production Backups card;
the surrounding Admin layout is unchanged. Both phone actions meet the 44px
target assertions, and all variants assert no horizontal overflow.

| State | Light | Dark | Phone |
| --- | --- | --- | --- |
| Successful publication and verification | [Light](spn-063-local-verified-light-production.png) | [Dark](spn-063-local-verified-dark-production.png) | [Phone](spn-063-local-verified-phone-production.png) |
| Corrupt newest archive; previous success retained | [Light](spn-063-local-failed-light-production.png) | [Dark](spn-063-local-failed-dark-production.png) | [Phone](spn-063-local-failed-phone-production.png) |

The local browser was Google Chrome 156.0.8078.47 because the pinned Playwright
browser was unavailable locally. The repository's CI configuration retains its
pinned browser. The final production run passed both tests in 11.9 seconds with
a guarded process peak of 1891.0 MiB and no resource abort. Earlier development
and production attempts exceeded the 2 GiB local guard; the test now closes its
browser during isolated verification. Those attempts are not passes.

Independent visual findings, approval and both independent implementation grades
are recorded against the exact reviewed commit in
[PR #205](https://github.com/mxbaylee/spinel/pull/205). Implementer inspection and
passing captures alone do not satisfy that gate. Review is agent review only.
