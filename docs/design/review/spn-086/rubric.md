# SPN-086 banner review rubric

Review each light/dark pair independently against the owner's attached references
and the approved light Spinel banner. Inspect rendered SVGs at phone (390 px),
desktop (1280 px), wide (2560 px) and picker-thumbnail widths. Code inspection
alone cannot establish artwork quality. Owner approval remains separate.

- **Reference fidelity — 30:** silhouette, central facet, plane arrangement and
  recognizable color identity match the supplied reference. Ruby/Sapphire/Amethyst/
  Rose Quartz have round outlines with square/triangle/hexagon/pentagon centers.
  Jasper is a three-plane kite; Peridot a rounded inverted triangle; Lapis a smooth
  teardrop; Pearl a luminous oval; Bismuth a stepped square spiral. Preserve Spinel.
  Obsidian uses the supplied character's charcoal/orange identity and curved lava
  markings, an interpretation rather than a claim of a standalone canonical stone.
- **Background shape language — 25:** the background visibly echoes that gem's
  distinctive geometry. No generic reused triangular field across unrelated gems.
  Curved stones have curved fields; square/stepped stones have square/stepped fields.
  Large, coherent, quiet regions; no accidental gaps or distracting edge artifacts.
  Owner refinement, 2026-10-26: the obvious gem must blend into the field as an
  extension of it. Assess local plane/curve continuity and shared boundary tones,
  not only similar shapes elsewhere or lower contrast. Ten of these 25 points
  specifically assess this gem-to-field relationship.
- **Theme pair — 20:** deliberate light and dark palettes, recognizable in both;
  dark backgrounds belong beside dark chrome without simply dimming the whole image.
  Preserve approved Spinel light pixels. Dark Spinel has an upside-down heart
  (owner refinement, 2026-10-26). No CSS darkening filter.
- **Composition and crops — 15:** complete focal gem at the existing left anchor;
  quiet space across the banner; no cut-off stone at phone, desktop, wide or thumbnail;
  no horizontal overflow, visible seams or accidental blank extensions.
- **Integration and maintainability — 10:** 24 local SVG assets reproducible from
  readable TypeScript; stories expose both variants; active theme switches the
  displayed artwork without changing selection; photos retain shared-image behavior.
  Artwork needs no external requests or new dependencies. This category grades the
  banner assets; the full production implementation is graded separately below.

Pass: **at least 95/100 for every pair, no blocking findings**. Report category
scores and concrete evidence for each pair. Every deduction, especially any score
below 95, must include actionable feedback. Re-review changed pairs after repairs.
Do not assume a desired result; an honest lower grade is necessary when warranted.


## Full ticket review

Final production scope, including owner-requested follow-ups, is independently
reviewed by two nonimplementing reviewers against the original ticket, full diff,
current CI and actual light/dark/phone captures on the same commit. Each reviewer
must score **above 95/100 with no unresolved blockers** before the authorized
squash merge. These are agent reviews, not a claim of owner visual approval.

- **Scope — 35:** persisted icons/emojis and icon colors at creation and edit;
  deterministic defaults, folder identity, paired automatic gem covers, photo
  variants/attribution, consistent modal geometry, Space accents; production
  Storybook controls and retirement of unowned mocks; UI-ticket migration rules;
  SPN-099 after-launch sequencing with a visible upstream PR prerequisite.
- **Correctness and access — 25:** permission/revocation boundaries, exact asset
  scope, validation/quotas, revision conflicts, offline identity and verified
  covers, editor/draft preservation, theme isolation, keyboard/focus/touch use.
- **Verification — 20:** meaningful unit/browser coverage, production persistence
  and offline flows, all retained Storybook interactions and native checks,
  current source-attributed light/dark/phone screenshots inspected independently.
- **CI and operations — 10:** required checks pass on the reviewed commit;
  bounded provider/upload work, safe credential handling, reproducible local
  assets, honest source and preview identities, documented unavailable checks.
- **Maintainability and complexity — 10:** one authoritative production UI,
  understandable modules, bounded fixtures and backlog fields; deduct for
  unnecessary abstractions, dependencies or speculative flexibility.

Report category totals, actionable feedback for every deduction, evidence and
finding disposition. Revalidate repairs on the final commit; do not average
scores or carry forward approval of changed code without reviewing it.
