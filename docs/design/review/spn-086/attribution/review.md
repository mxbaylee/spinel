# Quiet photo attribution — independent review

**Superseded by the owner's overlay/modal refinement.** See the
[current source review](overlay-modal-review.md); the below-photo contrast and
placement findings here are historical only.

Reviewer: `integration_review` subagent, 2026-10-26. Scope is only the attribution
change in `AppearanceReview.tsx`, its CSS/story, and the `Quiet photo attribution`
decision. The prior banner reviews and evidence are unchanged.

Source review found no blocking defect:

- Credit now sits in normal flow below the image, leaving the photo unobstructed.
  It remains visible at phone widths and uses a compact, muted 12 px treatment.
- Separate photographer/profile and Unsplash links include the referral parameters
  required by [Unsplash's official API attribution guidance](https://help.unsplash.com/en/articles/2511315-guideline-attribution).
  That guidance distinguishes API requirements from the standard license's optional
  attribution. Unsplash identifies Jon Matthews as `@jkmatt`.
- Muted text against its panel measures **6.73:1 in light mode** and **6.33:1 in
  dark mode**, sufficient for this text size. Links remain underlined and have
  explicit keyboard focus styling.
- The same small `PhotoCredit` component is reused under the banner and in the
  picker. No dependencies, requests, authority changes or unnecessary abstraction
  were added. The decision records all four persona effects and retains owner review.
- The new `PhotoAttribution` play function checks that the credit is visible below
  the cover and that both destinations are correct. Source inspection confirms its
  assertions; it has not been executed by this reviewer.

## Pending browser verification

Memory pressure remained elevated (`kern.memorystatus_vm_pressure_level=2`) during
this scoped review. No browser was launched, no new screenshots were captured,
and the new play function was not executed. Before claiming verified completion,
run `Redesign/Appearance/Photo Attribution` and inspect/capture the changed banner
and picker in light, dark and phone-width layouts. Check that the line stays below
the image, remains readable and focusable, and introduces no overflow.

No final numeric score or completion certification is issued. This is a source
review of uncommitted local work, not a merge approval. Exact reviewed source
SHA-256 values are recorded in [source-hashes.json](source-hashes.json).
