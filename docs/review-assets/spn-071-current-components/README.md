# SPN-071 current component evidence

Reviewed source: `c0e25022a52e63794b98d366317b9209df4022b2`, on main `df1d910822cba284178f26ac4f6cf359ddcfacef`.
This archive commit adds evidence only and is not the PR implementation head.

The supported local Storybook `--test` build retains production components and play functions, omitting documentation/docgen. The full hosted build remains a required separate check. Build passed in 4.986 s (1,535.5 MiB process-tree peak); all 85 combinations of 17 affected stories and five theme/viewport variants passed in 33.028 s (1,163.8 MiB peak), using the repository serial lock and 2 GiB memory-pressure watchdog. All play functions must report success; the manifest's empty additional-verifications list does not mean plays were skipped.

`source.json` pins the clean build, `manifest.json` records all checked identities and zero failures, and the raw logs preserve command/results. Eleven representative unmodified captures retain the same proposed component states as the original PR, now rendered from current integrated source. Light/dark desktop widths are 1280; phone/phone-dark widths are 390; all are 900 high. These are component fixtures using Chromium 156.0.8078.4 / Playwright 1.64.1 / Node 26.12.1 on the current Mac, with normal system fonts (no temporary font override). They are not physical-device captures or native editor proof. Separate actual production native images and interaction evidence live at the reviewed source under `docs/implementation/evidence/SPN-071/resumed`.

Current native and component visual findings/approval and final exact-head hosted CI/grades are recorded in PR #226. **Agent review only.** This evidence archive does not substitute for the seven required CI gates.
