# Attribution overlay and stable cover modal — source review

Reviewer: independent `integration_review` subagent, 2026-10-26. This supersedes
the earlier below-photo placement review. Scope is the current credit overlay,
Page cover modal sizing, two interaction stories and decision refinement; the
previously graded gem artwork is unchanged.

## Source findings

- Credit is again inside the photo: white 12 px linked text with a text shadow
  and no filled badge. It stays visible and moves to the upper left on phones,
  away from the lower-right Change cover control. Profile and Unsplash links,
  referral parameters and keyboard focus styling remain present.
- The old 6.73:1/6.33:1 panel contrast measurements do **not** apply to the new
  on-photo text. Its readability and focus outline require visual verification
  against the actual image/crop in both themes and at phone width.
- Popup sizing is scoped to the Page cover modal. Its fixed, viewport-bounded
  height and reserved preview/crop-control rows avoid geometry changes when
  switching source, selecting a photo, removing the cover or selecting a gem.
  The source panel scrolls independently. The picker itself also scrolls when
  a short viewport cannot fit its fixed rows, so controls are not deliberately
  hidden; reachability and nested-scroll behavior still need browser verification.
- The change reuses existing controls and adds no dependencies, provider calls
  or authority changes. The decision records the superseded placement and all
  four persona effects. No avoidable implementation complexity was identified.

One concrete regression-test defect was found and corrected: the photo result's
accessible name includes its image alt text as well as “Coastal cliffs”. A string
`getByRole` name match is exact in Testing Library, so removing an `exact` option
alone did not fix the selector. The implementing agent changed it to
`name: /Coastal cliffs/`; source reinspection confirms the correction. Unsupported
`exact` options were also removed from role queries. No unresolved source-level
blocking finding remains.

## Validation still pending

Memory pressure remained elevated (`kern.memorystatus_vm_pressure_level=2`), so
no browser was launched and no new screenshots or play-function execution are
claimed. Before verified completion:

1. Run `Photo Attribution` and `Cover Picker Stable Height` in Storybook.
2. Capture light, dark and 390 px phone layouts; verify the unfilled credit is
   readable and its links can receive visible keyboard focus without obstruction.
3. Check Gems/Upload/Unsplash, photo selection/removal, gem selection, empty search
   and upload-error states retain the same popup bounds.
4. At a short viewport such as 390 × 400, reach the final gem, Photo position,
   Remove cover and Done controls using the intended scroll areas. Check keyboard
   reachability, no horizontal overflow and no control overlap.

No final score, completion certification or merge approval is issued. This is a
source review of uncommitted local work. Exact reviewed sources are bound by
[overlay-modal-source-hashes.json](overlay-modal-source-hashes.json). Earlier
attribution evidence is retained as history and must not be presented as validation
of this revised layout.
