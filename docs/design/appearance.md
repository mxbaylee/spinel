# Covers and Space accents — exploration

Owner requested interactive Storybook drafts on 2026-10-22, during grooming.
These are post-launch design candidates, not approved production behavior.
SPN-086 still owns its existing icons/folder-colors scope; incorporating the
selected appearance design and its sequencing remains a grooming decision.

Open **Redesign → Appearance**. The stories reuse the full-editor chrome and
native Doc/Sheet engines, including a native editor inside the Space tree.
Start with Gems Collection or Spinel Soft Banner; compare the twelve Space accents; standalone Doc/Sheet gem
and photo covers; and Doc In Space With Banner. Theme switching also works.

## Draft interaction

- A Space accent colors navigation selection, focus and controls. It never
  recolors an independently chosen page cover, document text or spreadsheet cells.
- Each page can have a cover above its existing emoji/title/save row. Scroll
  past the cover to recover editor space; there is no automatic collapse on typing.
- **Space appearance** opens twelve accent choices. **Change cover** opens
  Gems, Upload and Unsplash. All controls are visible on touch screens.
- Gems offers one soft, borderless cover per character-inspired gem. Spinel reuses
  the owner's approved heart artwork; the other cuts interpret square Ruby,
  three-plane Jasper, Yellow Diamond, triangular Peridot, oval Sapphire,
  teardrop Lapis, hexagonal Amethyst, round Rose Quartz, luminous Pearl, angular
  Obsidian and stepped multicolor Bismuth. These are original geometric drafts.
- Both pickers follow the rainbow: Ruby, Jasper, Yellow Diamond, Peridot,
  Sapphire, Lapis, Amethyst, Spinel; then Rose Quartz, Pearl, Obsidian and Bismuth.
  Bismuth's multicolor swatch uses a single readable teal for controls. Pearl's
  cream cover uses a darker warm neutral accent for readable controls.
- The initial cover matches the story's accent; changing the accent subsequently
  never changes any cover. Cover colors stay fixed in light and dark mode.
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
theme surfaces, twelve proposed accent pairs in `src/ui/palette.ts`, and AA contrast
checks. Full-editor toolbar/canvas behavior is retained; the optional cover adds
an outer scroll region that must be judged on desktop and phone.

## Photo fixture

`src/ui/redesign/assets/coast.jpg`: “Coastal cliffs meet the ocean under a cloudy
sky”, [Jon Matthews on Unsplash](https://unsplash.com/photos/e0-Qsr4vIzo), under
the [Unsplash License](https://unsplash.com/license). Resized to 1600 px for this
offline review fixture. Credits remain visible in the picker and photo cover.

## Owner refinement, 2026-10-22

The owner approved the soft Spinel SVG before deployment, then requested the
complete collection plus Rose Quartz, Pearl, Obsidian and Bismuth in Storybook.
The new covers preserve that quiet field and left-side focal gem. This gives the
Owner more identity choices while Collaborator and Link guest retain readable
controls and unchanged authored content. Operator has no new provider or service.
The artwork for the additional gems and final ordering remain design candidates.
