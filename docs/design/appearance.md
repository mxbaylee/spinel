# Covers and Space accents — exploration

Owner requested interactive Storybook drafts on 2026-10-22, during grooming.
These are post-launch design candidates, not approved production behavior.
SPN-086 still owns its existing icons/folder-colors scope; incorporating the
selected appearance design and its sequencing remains a grooming decision.

Open **Redesign → Appearance**. The stories reuse the full-editor chrome and
native Doc/Sheet engines, including a native editor inside the Space tree.
Compare Space Ruby, Emerald, Sapphire and Amethyst; standalone Doc/Sheet gem
and photo covers; and Doc In Space With Banner. Theme switching also works.

## Draft interaction

- A Space accent colors navigation selection, focus and controls. It never
  recolors an independently chosen page cover, document text or spreadsheet cells.
- Each page can have a cover above its existing emoji/title/save row. Scroll
  past the cover to recover editor space; there is no automatic collapse on typing.
- **Space appearance** opens four accent choices. **Change cover** opens
  Spinel Gems, Upload and Unsplash. All controls are visible on touch screens.
- Spinel Gems offers two repeating facet patterns per color: Endless facets
  and Wide prism. The selected Space accent suggests the initial gem color;
  changing an accent never applies another cover to any page.
- Remove cover returns to Add cover. Page switching retains independent choices
  and native editor snapshots for the lifetime of the story.
- Upload previews a local JPG/PNG/WebP, with file validation and vertical crop
  adjustment. It makes no request and disappears when the story reloads.
- Unsplash uses an attributed bundled sample with a small local search filter.
  Live search, provider integration, storage and production authorization are
  outside this prototype. The sample is not evidence of a working integration.

## Personas and decisions still to make

Owner gains recognizable personal spaces; Collaborator gets stable navigation
and unchanged authored colors; Link guest needs the same readable identity without
extra account information or appearance permissions; Operator gets no new access
or external service in these local-only stories. Existing permission policies are
unchanged. Who may change Space accents and child covers needs explicit production
acceptance, including guest behavior and asset access/revocation.

Exact palette count, facet artwork, cover height/cropping and the treatment of
Space-root covers remain open for owner review. The prototype uses the existing
theme surfaces, four proposed accent pairs in `src/ui/palette.ts`, and AA contrast
checks. Full-editor toolbar/canvas behavior is retained; the optional cover adds
an outer scroll region that must be judged on desktop and phone.

## Photo fixture

`src/ui/redesign/assets/coast.jpg`: “Coastal cliffs meet the ocean under a cloudy
sky”, [Jon Matthews on Unsplash](https://unsplash.com/photos/e0-Qsr4vIzo), under
the [Unsplash License](https://unsplash.com/license). Resized to 1600 px for this
offline review fixture. Credits remain visible in the picker and photo cover.
