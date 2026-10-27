# SPN-086 independent integration review

Reviewer: independent `integration_review` subagent, 2026-10-26.
Scope: theme integration, saved SVG reproducibility, approved Spinel preservation,
Storybook verification and crops. This is not the overall artwork grade or owner approval.

## Verified

- All 24 saved SVGs exactly match `gemCoverSvg(gem, mode)` output.
- Sharp rendered the approved `HEAD` Spinel light generator and the new generator
  to raw 4000 × 180 RGBA pixels. All 2,880,000 bytes match exactly.
- Each cover source contains explicit light/dark data URLs, without CSS filtering,
  network loading or new dependencies.
- `GemCover` subscribes to the existing app theme store. That one component is used
  by the page cover, picker thumbnails, picker preview and active-theme collection.
  A theme change changes the source only; the cover selection state is independent.
- The paired gallery explicitly selects each mode and labels both variants.
- Three interaction stories cover all 12 collection variants, picker selection and
  preview preservation, and shared photo source preservation. They restore the
  previous theme in `finally`.
- CSS anchors the SVG left-center and preserves image aspect ratio. All focal
  shapes fit inside the existing x=80–230, y=21–171 placement. Gallery and picker
  containers use overflow clipping without resizing the stone independently.

## Browser verification

After memory pressure returned to normal (`kern.memorystatus_vm_pressure_level=1`),
Chromium ran the actual Storybook stories sequentially at localhost:6006. All five
reported `storyFinished.status=success`, with no page errors and no horizontal
document overflow:

- Gem Collection Theme Switch
- Gems Light And Dark
- Gem Picker Theme Switch
- Shared Photo Theme Switch
- Choose Bismuth Cover

The paired gallery loaded all 48 images (two modes × two crops × twelve gems).
Captured the full gallery at 390, 1280 and 2560 px and each of twelve pairs at
1280 px. Each viewport had no horizontal document overflow. Captured each actual
picker thumbnail at 390 and 1280 px in both modes: all 48 images loaded at their
4000 px natural width with `object-position: 0% 50%`. Visual inspection of the
thumbnail contact sheet confirms complete focal stones in every crop.

Evidence lives in [browser/](browser/): `results.json` records story statuses,
image loading, dimensions, crop alignment and overflow checks; `pairs-390.png`,
`pairs-1280.png`, `pairs-2560.png` are gallery screenshots; `<gem>-pair-desktop.png`
are per-set captures; `thumbnail-contact-sheet.png` combines all 48 actual picker
screenshots. `picker-light.png` and `picker-dark.png` show picker context; the
individual `thumb-<gem>-<mode>-<width>.png` files cover items below its scroll fold.

After these captures, all 24 saved SVGs were rechecked against the current
generator output and still match exactly. The approved Spinel light still matches
all original pixels. Dark Spinel is intentionally inverted in the current artwork.

**Final integration score: 10/10 for every pair.** No integration blockers or
unresolved findings. This does not replace the separate per-pair visual/artwork
grade or the owner's local Storybook approval.

## Final artwork refresh and source binding

The final near-field facet/curve refinement was rechecked after the earlier
integration pass. The collection theme-switch, paired gallery and picker theme-switch
stories passed again against the final SVGs. No browser errors or gallery overflow
were observed. All gallery widths, twelve desktop pair captures, picker context
screenshots and 48 individual thumbnails/contact sheet have been refreshed.

Reviewed source SHA-256 values:

- `src/ui/redesign/gemCovers.ts`: `585e40e92b30c5521f929e7484fe539acd12234076cf5190565563a721b8e3c6`
- `src/ui/redesign/spinelCover.ts`: `51fa19ea739ed1e8e078ea538c042b1c094420505b7912aa241805d27e04c5d5`

`browser/results.json` also records hashes for integration files and all 24 SVGs.
Those files remained unchanged throughout capture. The saved SVGs again reproduce
exactly and the approved light Spinel pixels still match the original.

The reviewer visually inspected the refreshed 48-thumbnail contact sheet and Ruby,
Lapis and Spinel desktop pairs: stones remain complete at both picker sizes,
current near-field geometry is visible, and light/dark identity is preserved.
A Chromium locator-screenshot issue omitted some offscreen text despite correct
DOM styling; desktop pair evidence was recaptured from normal viewport screenshots
and cropped to the visible section. The refreshed Spinel capture visibly includes
both mode labels and all crop captions. The extra `spinel-viewport-proof.png` shows
its uncropped browser context.

Final integration grade remains **10/10 for each of the twelve pairs**, with no
unresolved integration findings. The separate art reviewer owns the final overall
grade for each pair.
