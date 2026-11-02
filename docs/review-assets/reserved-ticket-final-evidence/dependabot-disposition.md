# Focused grooming: newly opened dependency PRs

2026-11-02. Seven Dependabot PRs opened while PR236 validation was running.
The accompanying JSON records preserve each head, body, file list and current
check rollup; patches preserve direct manifest/container changes. These are bot
updates, not competing ticket owners. All remain open for separate review.

Security: the Dependabot-alert API returned HTTP403, explicitly stating that
alerts are disabled for this repository. No claim of no vulnerabilities follows.
The supplied update bodies did not establish a targeted security remediation;
compatibility badge links and unrelated AWS service features are not advisories.
Security advisory verification remains necessary before these updates land.

- PR238 Caddy digest refresh: container/proxy compatibility needs validation.
  The snapshot includes pending CI and a failed Storybook aggregate; classify
  the failure before reuse. Keep separate from application dependency changes.
- PR239 Node 26.12.1 to 26.13.0 in both Docker stages: reconcile the repository's
  pinned runtime and native SQLite/install compatibility. CI remains pending
  with failures in the rollup; no accepted current-head result yet.
- PR240 coordinated Univer 1.1.0 to 1.2.0 group: retain the coordinated group.
  Requires current patch compatibility, native Doc/Sheet content, sync, Undo/Redo,
  performance, rendering and independent visual review. Do not replace the pinned
  historical SPN-135 reproduction with this update or count it as its repair.
- PR241 oxlint 1.88.0 to 1.89.0: release notes explicitly mention AST breaking
  changes for lone surrogates. Review actual lint behavior before landing.
- PR242 Storybook 10.6.2 to 10.6.4: requires build, interaction and relevant visual
  review. Keep coordinated with its addons if the complete lockfile requires it.
- PR243 AWS S3 client 3.1152.0 to 3.1156.0: inspect lockfile changes and preserve
  real object-storage backup/restore compatibility. Pending checks are not proof.
- PR244 Vite 8.3.4 to 8.3.5: chunk import-map/build fixes affect production assets;
  verify production build, offline cache/upgrade and native loading paths.

Keep the existing semantically coherent Univer group. Other runtime, proxy, SDK,
lint and bundler updates have different acceptance boundaries and should remain
separate while compatibility and CI are unresolved. No update was auto-merged,
rebased, cancelled or assigned to another agent by this grooming checkpoint.
