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
