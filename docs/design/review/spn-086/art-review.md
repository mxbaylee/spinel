# SPN-086 independent artwork review

Reviewer: independent `art_review` subagent, 2026-10-26. This reviewer did not
implement the art or Storybook integration. Rubric: [rubric.md](rubric.md).

## First pass — revision required

Evidence: rendered `pairs.png` (all twelve light/dark pairs, first 1000 SVG pixels
of each banner), focal enlargements of Peridot, Lapis and Bismuth, attached owner
references, and `gemCovers.ts` / `AppearanceReview.tsx` / CSS inspection. Scores
are provisional: phone, desktop, wide and picker browser captures and theme-switch
execution were not yet available. No pair is finally verified by this pass.

Score notation: reference /30, background /25, theme /20, composition /15,
integration /10. The shared composition score of 12 withholds three points until
all required crops are visually verified. Integration 7 withholds three points
until browser theme-switch and generated-asset consistency checks are evidenced.
These are explicit evidence gaps, not claims of broken behavior.

- **Ruby: 87/100** — 29 / 19 / 20 / 12 / 7. Correct round outline and square
  central facet; warm left plane and darker right/bottom are recognizable. The
  center occupies less of the stone than the reference. Enlarge it modestly
  (reference about 40% of diameter versus current 38/94). Repeated concentric
  squares read as isolated tiles; extend square planes at differing scales and
  offsets so the field has the quiet continuity of Spinel.
- **Jasper: 89/100** — 30 / 20 / 20 / 12 / 7. Three-plane pointed kite and warm
  color hierarchy match well. Every field unit repeats the same width and apex
  position. Introduce broader, nonuniform kite planes and avoid the repeated
  zigzag seam at the same vertical position.
- **Yellow Diamond: 85/100** — 30 / 16 / 20 / 12 / 7. The central rhombus and
  bevels match. Background is literally Jasper's three-plane kite mesh; replace
  it with Yellow Diamond's four beveled rhombus planes, varied in scale and crop.
- **Peridot: 81/100** — 23 / 20 / 20 / 11 / 7. Color, inverted triangle and
  rounded highlight work, but the top-left is not a continuous silhouette:
  uncovered space separates the top bevel from the left edge; the bottom point
  has a thin gap. The entire outline is also too tall relative to the reference.
  Add a complete base silhouette, align adjacent face vertices, widen/shorten the
  gem, and enlarge/offset background triangles to reduce the wallpaper cadence.
- **Sapphire: 86/100** — 29 / 18 / 20 / 12 / 7. Round silhouette and triangular
  center match; the two top sectors are reversed in lightness versus the supplied
  reference. Match that plane hierarchy. The background's circles are mostly
  hidden behind continuous identical triangles, giving a zigzag field. Retain
  visible curved sector boundaries around the triangular geometry and vary scale.
- **Lapis: 81/100** — 23 / 19 / 20 / 12 / 7. Smooth shading is appropriate,
  but the silhouette is squat: the reference is a tall teardrop whereas this one
  is almost as wide as high. Narrow the sides around x=50 to approximately 65–70%
  of height. Its highlight creates an unintended dark triangular cap at the tip;
  extend the curved highlight to the tip. Expand curved background regions so
  they do not read as repeated little hook/leaf shapes.
- **Amethyst: 90/100** — 30 / 21 / 20 / 12 / 7. Correct round outline,
  hexagonal center and six surrounding sectors. The background is a uniform row
  of nested hexagons. Use larger offset hexagonal regions with some boundaries
  beyond the frame instead of repeating complete inset hexagons at one scale.
- **Spinel: 94/100, evidence pending** — 30 / 25 / 20 / 12 / 7. The approved
  light composition is visually retained and the deliberate plum dark version
  is coherent. No visual repair identified in the montage. Verify exact light
  asset preservation and all required browser crops/theme switching before pass.
- **Rose Quartz: 89/100** — 30 / 20 / 20 / 12 / 7. Round outline, pentagonal
  center and surrounding pink planes match. The background repeats a row of
  identical shield-like pentagons; vary size/offset and let their planes extend
  past the frame to make an environmental field rather than a symbol pattern.
- **Pearl: 85/100** — 28 / 18 / 20 / 12 / 7. Broad curved highlight and pale
  lavender shadow preserve the reference. Oval is slightly broad, and a narrow
  lavender hairline wraps the left edge unlike the reference's mostly unbroken
  pale left side. Narrow slightly and carry the highlight into that left edge.
  Field repeats identical overlapping scallops with sharp little joins at top
  and bottom; use larger, differently placed oval regions for a calmer surface.
- **Obsidian: 81/100** — 27 / 17 / 18 / 12 / 7. The charcoal stone and orange
  seams plausibly interpret the supplied full-character reference. Uniform thin
  spirals form a decorative border and dominate the backdrop, rather than broad
  curved orange/charcoal regions. Use fewer oversized curved lava planes, crop
  them deliberately, and strengthen the orange enough to retain the reference
  identity in both themes. This is an interpretation, not a canonical stone.
- **Bismuth: 80/100** — 25 / 17 / 19 / 12 / 7. Nested square terraces and
  green/yellow core are present, but the lower-left spiral opening is ambiguous;
  it reads like a block laid over the lower frame. Draw a continuous stepped
  spiral with clearly connected corner/notch planes matching the reference.
  The field's disconnected green blocks and identical nested boxes compound this;
  replace them with continuous square terraces at varied scales. Increase the
  cyan/mint distinction modestly so this reads as multicolor rather than mostly
  lavender in both modes.

## Priority repair order

1. Fix Peridot gaps and reference proportions; fix Lapis proportions/tip shading;
   make Bismuth's stepped path continuous.
2. Replace the shared Jasper/Yellow Diamond background and the stamp-like field
   cadence in the other new sets. Preserve Spinel as the quietness reference.
3. Improve Obsidian's broad lava identity and Pearl's oval/highlight treatment.
4. Supply all required browser crop captures and execute theme switching, then
   re-review each pair against this same rubric. No score threshold is waived.

## Second pass — geometry repairs confirmed, two artwork repairs remain

Evidence: regenerated `pairs.png`, regenerated SVGs, focal enlargements of
Peridot/Lapis/Bismuth beside the supplied PNGs, and updated source inspection.
Browser crop and integration evidence remains pending, so the shared 12/15 and
7/10 evidence caps still apply. Scores use the same category order as above.

**Reviewer corrections:** withdraw the first-pass Ruby center-size deduction:
38/94 is 40.4%, consistent with the reference. Withdraw the first-pass Sapphire
plane-lightness deduction: the left sector is already darker than the right in
both palettes. Neither requires an implementation change.

- **Ruby: 93/100** — 30 / 24 / 20 / 12 / 7. Correct round/square construction;
  expanding square fields are much quieter. Optional remaining polish: soften the
  vertical boundary between the second and third square fields so it reads less
  like adjacent tiles.
- **Jasper: 93/100** — 30 / 24 / 20 / 12 / 7. Three planes remain faithful and
  growing kite regions resolve the wallpaper cadence. Optional remaining polish:
  stagger one background apex vertically to break the residual shared crease line.
- **Yellow Diamond: 93/100** — 30 / 24 / 20 / 12 / 7. Now uses its own four
  beveled rhombus planes; distinct from Jasper. Optional remaining polish: vary
  one bevel width so successive enlarged diamonds feel less mechanically scaled.
- **Peridot: 92/100** — 29 / 24 / 20 / 12 / 7. Base fill resolves holes and
  adjusted aspect is close to the broad reference. Upper-left bevel junction is
  still sharper than the rounded reference: soften that join if further polishing.
  Background triangular field is coherent; optional stagger of one apex would
  reduce the residual common crease line.
- **Sapphire: 93/100** — 30 / 24 / 20 / 12 / 7. Correct circular stone and
  triangular core, now visibly echoed by curved background sectors. Optional
  remaining polish: vary one sector's rotation/offset to avoid exact enlarged
  duplicates. No change to existing facet lightness is needed.
- **Lapis: 93/100** — 30 / 24 / 20 / 12 / 7. Tall teardrop and uninterrupted
  curved tip highlight now match the reference. Curved field opens out toward the
  right. Optional remaining polish: soften the angular boundary where two field
  drops overlap at the top edge.
- **Amethyst: 93/100** — 30 / 24 / 20 / 12 / 7. Correct round/hexagon gem;
  broader hexagonal planes read coherently. Optional remaining polish: vary the
  inset ratio of one distant hexagon rather than only scaling the same construction.
- **Spinel: 94/100, evidence pending** — 30 / 25 / 20 / 12 / 7. No new visual
  finding; full crop and integration evidence still needed.
- **Rose Quartz: 92/100** — 30 / 23 / 20 / 12 / 7. Gem matches the reference.
  Expanded pentagons improve the field; repeated vertical center splits remain
  more conspicuous than Spinel's flow. Shift one distant pentagon off the shared
  center height and soften that plane's tonal jump.
- **Pearl: 92/100** — 30 / 23 / 20 / 12 / 7. Narrower oval and highlight
  reaching the left edge repair the focal gem. The field remains very flat over
  large areas with sharp cusp joins at top/bottom. Further polish would overlap
  two differently centered oval planes to eliminate one or two pointed joins.
- **Obsidian: 86/100 — revise** — 28 / 19 / 20 / 12 / 7. Reference color
  identity is clearer, but the change mostly thickens the spiral strokes. They
  remain an orange foreground ornament over a generic triangular background and
  draw more attention than the gem. Replace some strokes with broad, cropped,
  filled charcoal/orange curved regions; reduce their contrast and visible count.
  Integrate a curved orange plane into the focal gem so its identity comes from
  the same shape language rather than only two thin straight seams. This remains
  an artistic interpretation of the supplied character, not a canonical gemstone.
- **Bismuth: 88/100 — revise** — 26 / 23 / 20 / 12 / 7. Connected stepped
  background is improved. The focal reference has an extra inner green/cyan bevel
  ring: the current top and right planes run directly from the outer inset square
  to the yellow core, losing that tier. Add the nested bevel tier (approximately
  outer 20–80, intermediate 29–71, center 38–62 coordinates), with separate mint,
  cyan and blue/purple planes. Carry the lower-left stepped notch through both
  tiers, rather than drawing the step only as an outline on a flat colored block.
  Optional field polish: taper the mint/cyan plane contrast farther to the right.

The first ten sets above (all except Obsidian/Bismuth) have no remaining artwork
blocker; their optional polish deductions would still permit a final >=95 if the
pending crop and integration evidence passes. The two marked “revise” need visual
repair and a fresh review before their scores can reach the acceptance threshold.

## Third pass — prior repairs improved; owner blend refinement needs implementation

The owner has added two requirements: gems should remain obvious while blending
into the background as an extension of it, and dark Spinel must be upside down.
The rubric now states these within the existing 100 points. In particular, 10 of
its existing 25 background points assess local gem-to-field continuity. This is
new scope from the owner, not a retroactive claim that the earlier passes used it.

Evidence: regenerated `pairs.png` and source. Browser evidence is being gathered
separately; shared 12/15 composition and 7/10 integration caps remain for now.
Dark Spinel is correctly inverted, including nearby field planes. Bismuth's
missing inner mint/cyan tier is restored. Obsidian's filled curved regions are
substantially calmer and resolve the foreground-spiral problem.

However, the other eleven stones remain visibly separate silhouettes over the
field. Softening their palettes helps quietness but does not create the requested
extension: their boundary transitions and nearby field lines do not meet.
The source also confirms that focal faces and background are independent meshes.
Do not repair this by merely lowering contrast further; that risks losing the
“obviously present” part of the request. Connect selected local facets/curves,
match some adjoining tones, and retain the distinctive central face.

Scores: reference /30, background /25, theme /20, composition /15, integration /10.

- **Ruby: 86/100** — 30 / 17 / 20 / 12 / 7. Keep square core and circular
  silhouette cues; extend the four corner rays into the nearest square field and
  share the top/left adjoining tones so the complete circle is not a cutout.
- **Jasper: 86/100** — 30 / 17 / 20 / 12 / 7. Continue the long central seam
  and one kite edge into the immediate background; carry the three-plane color
  relationships through those joins.
- **Yellow Diamond: 86/100** — 30 / 17 / 20 / 12 / 7. Continue its four
  bevel junctions into the nearest background rhombus. Match two adjacent bevel
  tones across the boundary while preserving the central diamond.
- **Peridot: 85/100** — 29 / 17 / 20 / 12 / 7. Extend the sloping left/right
  bevels into the nearest triangle; retain the rounded highlight and round the
  remaining sharp upper-left junction.
- **Sapphire: 86/100** — 30 / 17 / 20 / 12 / 7. Continue the triangular core's
  rays into the circular field sectors, with shared tones along selected arcs.
- **Lapis: 86/100** — 30 / 17 / 20 / 12 / 7. Continue the highlight's curved
  tangent into an adjacent broad curve; share one outer side's tone with that
  background region while preserving the pointed drop and rounded lower body.
- **Amethyst: 86/100** — 30 / 17 / 20 / 12 / 7. Extend selected hexagon-corner
  rays into the nearest hexagonal field. Share the upper or left sector tone
  across the circular silhouette to connect the gem without losing its core.
- **Spinel: 94/100, evidence pending** — 30 / 25 / 20 / 12 / 7. Existing
  near-field geometry meets its facets; light is retained, dark is now inverted.
  No visual repair identified. Still needs full crop/integration verification.
- **Rose Quartz: 85/100** — 30 / 16 / 20 / 12 / 7. Continue pentagonal-core
  rays through the round edge into matching local pentagonal regions; soften the
  residual repeated vertical field splits rather than only the gem palette.
- **Pearl: 85/100** — 30 / 16 / 20 / 12 / 7. Join a broad oval highlight or
  shadow tangent to the immediate field. Preserve a readable oval on the opposite
  side and smooth one or two distant pointed overlap joins.
- **Obsidian: 84/100** — 28 / 17 / 20 / 12 / 7. Broad background lava regions
  are now appropriate, but the angular stone's straight orange seams terminate
  abruptly inside a separate silhouette. Carry one seam into a curved lava band
  with a shared charcoal plane; give the gem the same local curved lava language.
- **Bismuth: 85/100** — 29 / 17 / 20 / 12 / 7. Inner tier now matches. Connect
  one of its square terraces/notch paths to the nearest background terrace and
  share the mint/cyan plane tones at that boundary. Keep enough central stepped
  detail to distinguish the stone from its larger field.

All deductions are repairable within the current vector approach. This pass does
not verify completion. Re-review the joined local geometry and the browser crops.

## Fourth pass — artwork accepted, awaiting final browser capture refresh

The new local continuation geometry resolves the third-pass blocker. Selected
facet boundaries now continue out into the field; curved gems have aligned curved
extensions. This is a meaningful geometry change, not only a reduction in opacity.
The limited-strength transitions preserve an obvious stone while connecting it to
its larger field. Dark Spinel remains upside down and light Spinel is unchanged.

Current rendered evidence: regenerated `pairs.png`, plus reviewer-created
`review-crops-light.png` and `review-crops-dark.png`. Each crop sheet shows every
current set at 390×112 phone, 140×80 picker and 2560×144 wide sizes, using the
verified CSS's height scaling and left-center crop. Inspected all current crops
in both modes: complete recognizable focal stones, no crop collision, no seams,
and quiet right-side fields. The separate [integration review](integration-review.md)
awards 10/10 for all pairs and verifies actual theme switching and saved assets.
Final browser captures must still be refreshed after the local-continuation change.
The grades below are provisional only until that refresh is checked.

Score order: reference /30, background /25, theme /20, composition /15,
integration /10. Remaining deductions are nonblocking polish suggestions;
there are no remaining artwork blockers.

- **Ruby: 98/100** — 30 / 23 / 20 / 15 / 10. Correct circular silhouette and
  square core; the four corner directions now connect to broad local planes.
  Light/dark both read clearly at thumbnail size. Optional polish: soften the
  vertical transition between distant nested-square fields and vary one inset
  ratio to reduce their residual mechanical cadence.
- **Jasper: 98/100** — 30 / 23 / 20 / 15 / 10. Three-plane kite is faithful;
  its long edges continue into the nearby warm field. Optional polish: stagger a
  distant kite apex vertically and soften one repeated horizontal crease.
- **Yellow Diamond: 98/100** — 30 / 23 / 20 / 15 / 10. Four bevels, central
  rhombus and connected local planes are clear. Optional polish: vary one distant
  bevel width and soften the rightward horizontal plane transition.
- **Peridot: 97/100** — 29 / 23 / 20 / 15 / 10. Broad rounded triangular
  form, yellow highlight and connected sloping planes work in all reviewed crops.
  Optional polish: round the upper-left bevel junction further; shift one distant
  triangle apex and reduce the remaining common crease alignment.
- **Sapphire: 98/100** — 30 / 23 / 20 / 15 / 10. Round stone with triangle
  core; local sector rays connect into the background without losing the circle.
  Optional polish: vary one distant circular sector rotation/offset and reduce
  the cadence of the repeated enlarged triangular centers.
- **Lapis: 97/100** — 30 / 22 / 20 / 15 / 10. Tall smooth drop and highlight
  match; curved extensions integrate it with the field. Optional polish: make
  the upper-right extension's far edge more curved, soften the top overlap cusp,
  and vary the spacing of one distant drop region.
- **Amethyst: 98/100** — 30 / 23 / 20 / 15 / 10. Six-sided center, round
  exterior and purple sector hierarchy stay clear; top/bottom continuations
  connect into the hexagonal field. Optional polish: vary one distant inset ratio
  and offset a hexagon vertically to reduce the shared centerline.
- **Spinel: 100/100** — 30 / 25 / 20 / 15 / 10. Approved light artwork
  preserved; upside-down dark heart and near-field planes remain continuous and
  readable. Both themes retain the intended quiet facet field and complete crops.
  No deduction or repair identified against this rubric.
- **Rose Quartz: 97/100** — 30 / 22 / 20 / 15 / 10. Round gem/pentagonal
  center and pink hierarchy match, with selected planes continuing outside the
  silhouette. Optional polish: offset a distant pentagon, soften its repeated
  vertical split, and vary the scale ratio between two neighboring regions.
- **Pearl: 97/100** — 30 / 22 / 20 / 15 / 10. Luminous oval and lavender
  curved shadow remain readable; tangent curves extend into the nearby field.
  Optional polish: eliminate one sharp distant overlap cusp, introduce a subtle
  second broad tone in the largest near-flat area, and vary one oval center.
- **Obsidian: 95/100** — 28 / 22 / 20 / 15 / 10. Charcoal/orange identity,
  connected seam and quiet broad lava curves satisfy the interpretation brief;
  it remains visibly present in dark mode. Optional polish: bring one curved lava
  motif onto the focal stone itself (two reference points), soften the local
  straight-to-curved join, vary a distant arc's width, and reduce the remaining
  angular local-field emphasis (three background points). These are refinements,
  not ambiguity about a canonical standalone Obsidian stone; none was supplied.
- **Bismuth: 96/100** — 29 / 22 / 20 / 15 / 10. Inner bevel tier, yellow
  core and stepped notch are restored; local square planes continue into larger
  multicolor terraces. Optional polish: make the notch's smallest turn more
  legible at thumbnail size (one reference point), taper distant mint/cyan
  contrast, vary one spiral inset spacing, and soften the transition between
  local terrace and first large spiral (three background points).

Reviewed generator SHA-256:
`585e40e92b30c5521f929e7484fe539acd12234076cf5190565563a721b8e3c6`.
Reviewed Spinel generator SHA-256:
`51fa19ea739ed1e8e078ea538c042b1c094420505b7912aa241805d27e04c5d5`.

## Final verification — all twelve pairs pass

The final browser refresh is now inspected. This reviewer checked all 48 actual
picker thumbnails in `browser/thumbnail-contact-sheet.png`, every pair in the
390 px and 2560 px gallery screenshots (split into readable sections), and all
24 theme banners extracted from the twelve 1280 px pair captures. The images
contain the current local-continuation geometry and agree with the fourth-pass
reviewed generator hashes above. Complete stones remain readable, all theme
pairs retain their intended identity, and the browser crops reveal no new issue.
The separate integration reviewer confirmed final 10/10 scores and exact saved
asset reproducibility after refreshing the evidence. No unresolved findings.

**The fourth-pass grades are now final:** Ruby 98, Jasper 98, Yellow Diamond 98,
Peridot 97, Sapphire 98, Lapis 97, Amethyst 98, Spinel 100, Rose Quartz 97,
Pearl 97, Obsidian 95 and Bismuth 96. Every pair meets the owner's threshold of
at least 95/100 with no blockers. Category breakdowns, evidence and optional
nonblocking refinements are recorded in the fourth-pass section above.

This independently verifies the requested banner artwork and Storybook review
integration. It does not assert owner artwork approval, completion of the full
SPN-086 persistence/provider scope, or authorization to merge.
