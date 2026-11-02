# SPN-071 current hosted production views

These 14 actual application captures supersede the local native screenshots for
final visual review. CI run 41403554716 / job 125141657384 (production 1/2) tested
merge `511dba1abe8019c699ce9cb08e54255dbafc1fdd`, head
`53ad6848d79b7b5034db6f6e99a107a518f5d9e5`, base
`df1d910822cba284178f26ac4f6cf359ddcfacef`. Head and merge have identical tree
`a5a1898d269b5db5338c97f84365ac270af2451f`. The production job passed 81 cases
with three declared skips, zero retries. The overall CI run failed the separately
recorded mobile responsiveness check; these images do not waive that blocker.

Source artifact 13123836219, original ZIP SHA-256
`8197d8eb5f1b5f45502ce7708d7ef83ca0ca62094e0ecb126f715defe7ec1468`.
The original 36 MB ZIP also holds unrelated captures, omitted here. Retained images
are byte-for-byte originals; `hashes.json` and `manifest.json` identify each file.
The job log retains its clean `npm ci` and current postinstall SDK patch execution.

Desktop menu/access-dialog views are 1280×900. Hidden-list and native Doc phone
views are 390×844 Chromium emulation, light/dark as named; no physical-phone claim.
The native sequence covers viewer, live upgrade with Done, return to reading with
Edit, and the Traditional layout restriction after its account-role upgrade.

Earlier local native images and targeted browser runs borrowed the root shared
dependency install. On 2026-11-02 a dry patch audit found missing current docs and
docs-ui patches there (core/UI patches were present). Matching manifests and
lockfile had not established matching postinstall state. Those earlier local
runs remain historical evidence under that limitation; they cannot be called the
same runtime as this hosted build. The root shared installation was left intact.
This worktree's symlink was replaced for a private install, but the first npm ci
was resource-aborted at pressure 2 / RSS 620.875 MiB after 2278 ms, not a pass. No local
native check after that interruption has been claimed.

Hosted CI evidence remains valid. The locally reviewed Dashboard/access-detail
component designs do not instantiate the patched native editor services; their
source identities and separate Storybook execution records remain explicit.
Independent review of these refreshed actual-app images is still required before
final agent-only visual approval and merge.
