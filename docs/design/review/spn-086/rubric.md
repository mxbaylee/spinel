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
  No external requests or new dependencies; changes confined to artwork exploration.

Pass: **at least 95/100 for every pair, no blocking findings**. Report category
scores and concrete evidence for each pair. Every deduction, especially any score
below 95, must include actionable feedback. Re-review changed pairs after repairs.
Do not assume a desired result; an honest lower grade is necessary when warranted.
