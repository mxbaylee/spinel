# Node 26 dependency updates

## Align the runtime and verify the production image

**2026-10-26 — accepted, agent judgment for the owner's request to merge the
Dependabot PRs individually, hardest first.** Source:
[runtime PR #165](https://github.com/mxbaylee/spinel/pull/165).

Use Node 26.12.1 in `.nvmrc` and both digest-pinned bookworm-slim Docker stages,
and require at least that version for the application. A Docker-only update
would leave development and the host-based CI suites on Node 24; keeping those
versions aligned makes the runtime change reviewable. Keep the existing Node 24
type package until the separate [types PR #171](https://github.com/mxbaylee/spinel/pull/171).
The standalone print library's Node 24+ contract remains unchanged: this update
does not introduce a Node 26-only API into that package.

[26.12.1](https://nodejs.org/en/blog/release/v26.12.1) is the October 21 security
release. Node 26 is still Current on this decision date, with LTS scheduled for
October 28 in the [upstream release schedule](https://github.com/nodejs/Release/blob/main/schedule.json).
The owner requested this major update; acceptance depends on actual compatibility
evidence rather than treating it as already LTS. Retain Debian bookworm/glibc,
the current database implementation and all package resolutions. No deployment
or live-data migration is part of this pre-production dependency change.

Add one container smoke job for every non-documentation CI change, reusing the
existing classifier. A new path classifier would add maintenance and could miss
packaging dependencies. Include its result in the existing required Playwright
aggregate: only successful browser and container jobs, or an explicitly classified
documentation-only skip, can pass. Preserve the seven required check names.

The smoke builds the real Dockerfile, checks native Canvas, Sharp and the print
workspace import, and starts the image with its default non-root user and command.
It uses the deployment's read-only filesystem, capability, process, memory and CPU
constraints with an isolated writable data directory. Check the built sign-in
page and a real JavaScript asset, the signed-out API boundary, and database
integrity through the first-party wrapper. Issue one setup link, keep its private
fragment out of logs, and compare the stored record after a graceful stop and
container recreation using the same complete data directory. This is packaging,
native-binding and persistence evidence; full authenticated journeys remain in
the browser suites. Deployment preflight and operator configuration are unchanged.

**Persona effects:** the Operator gets one tested runtime and a reproducible
production image; the Owner and Collaborator retain their document, account and
shared-edit behavior under full regression coverage; the Link guest retains the
existing authentication and sharing boundaries. No visual design change is intended.

**Verification:** require the seven CI gates, the actual container smoke and all
applicable Storybook rendering and interaction checks at the final head, followed
by independent review. Local Docker is unavailable in this workspace; only the
hosted container result may be recorded as container execution evidence.

## Align the Node API declarations

**2026-10-26 — accepted, agent judgment within the same owner-authorized sequence.**
After runtime [#165](https://github.com/mxbaylee/spinel/pull/165),
[#171](https://github.com/mxbaylee/spinel/pull/171) updates `@types/node` to 26.6.5
and its required `undici-types` dependency to 8.9.0. Preserve all other package
resolutions and native platform metadata.

The new declarations correctly make `process.disconnect` optional outside a
forked child. The native print test fixture requires IPC to return its results
and terminate, so check both completion functions before calling them. Fail
explicitly if the required channel API is absent; do not silently skip completion.
The existing native print tests exercise the real child-process path. This adds
no Node 26-only library API and retains the print package's Node 24+ contract.
The persona and verification decisions above apply to this second phase as well.

## Advance the aligned runtime to 26.13.0 LTS

**2026-11-02 — accepted, agent judgment for the owner's request to merge
Dependabot PRs individually, most complex first.** Source: [PR #239](https://github.com/mxbaylee/spinel/pull/239).

Advance `.nvmrc`, both Docker stages and the root application/lockfile engine
minimum together to 26.13.0. The [official October 28 release](https://nodejs.org/en/blog/release/v26.13.0)
changes LTS metadata only relative to 26.12.1. The Docker image's immutable index
digest, `sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9`,
matches [Docker's official image record](https://github.com/docker-library/repo-info/blob/7d6f3328b3b63fcd8eb2674cd5984498ab63e21a/repos/node/remote/26.13.0-bookworm-slim.md).
Retain bookworm/glibc, all package resolutions and the independent print
library's Node 24+ contract.

The original Docker-only candidate's [container check](https://github.com/mxbaylee/spinel/actions/runs/41489528110/job/125430989943)
built the image but correctly rejected actual `v26.13.0` against `.nvmrc`'s
expected `v26.12.1`. Its successful host tests used the old runtime. Keep that
assertion and require fresh full host and production-container validation on the
aligned candidate; do not count the earlier run as new-runtime acceptance.

Keep [SPN-117's development-only fast API mitigation](SPN-117.md). This release
does not claim to fix the crash: [the flag](https://github.com/nodejs/node/blob/v26.13.0/deps/v8/src/flags/flag-definitions.h)
and [the guarded compiler target selection](https://github.com/nodejs/node/blob/v26.13.0/deps/v8/src/compiler/fast-api-calls.cc)
remain in the selected source. The existing watched-development test and
development browser suites must verify flag acceptance and the affected Vite
workload under 26.13.0. Preserve all existing timing, retry and failure gates.

The Operator gets a reproducible LTS runtime aligned with development and CI;
Owner and Collaborator editing/persistence and Link guest access remain covered
by the existing full suites. No UI design, deployment or data migration changes.
Final source, checks, independent grades and any failure dispositions belong in
the PR description; planned validation here is not a claim that it ran.
