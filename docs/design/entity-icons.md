# Entity iconography

Docs, Sheets and planned Spaces use a shared gem silhouette with distinct
interior marks derived from Spinel's original faceted-heart visual language. The app logo and favicon keep their
existing identity. Owner direction, chat 2026-10-20; implemented in SPN-077,
authorized before the broader SPN-047 redesign and before Spaces exist.

## Shape and colour

- **Doc:** blue, three text strokes, with the approved bolder 1.25-unit lines (B2a).
- **Sheet:** green, a header-and-rows mark (S1).
- **Space:** purple, three collection diamonds contained within the front face (B2c).

The owner selected the common B2 beveled outline and equal visual bounds for all
three. Interior marks and adjacent labels distinguish type without colour alone;
this supersedes the draft requirement for distinct outer silhouettes. Owner,
chat 2026-10-20, [decision #122](https://github.com/mxbaylee/spinel/issues/122).
Review at 16, 24 and 32px, in monochrome, in both themes and at social-card size.

Keep one consistent SVG viewBox, normally 24×24, with enough internal padding to
avoid clipping. Preserve vector geometry at every output size. These are
original code-native assets, not generated bitmap images. Keep raw SVGs small,
without scripts, external references or raster payloads; a new optimizer package
is not required if the authored paths are already compact.

Use the existing palette/token system for light and dark facet tones, preserving
blue/green/purple. The `entity-<doc|sheet|space>-0` through `-4` tokens define
edges and facets;
`entity-mark` defines their white interior glyph. Both themes preserve the approved
art colours. Decorative shading is not a text contrast pair: visible type labels
use existing accessible text tokens. Monochrome uses `sp-text` for the silhouette
and `sp-panel` for its mark, covered by the contrast checks. Do not borrow
status colours or hard-code a separate theme in each consumer. Server-rendered SVG resolves palette values explicitly because a PNG
renderer cannot inherit browser CSS variables. Share geometry and colour mapping
between browser and server rather than maintaining two drawings.

## Placement and accessibility

Use the type facet beside the existing Doc/Sheet creation choices and document
names in owned/shared lists and relevant navigation. Do not replace the full
name or remove a text type label where it is needed. Decorative SVGs beside a
sufficient label are hidden from assistive technology; a standalone meaningful
icon has an accessible type name. A button's name describes its action.

The current New control uses a native type selector. A replacement visual type
picker with facet-and-label choices is allowed; its component-library adoption
belongs to SPN-047, where the owner selected Base UI (decision #120, chat
2026-10-20). SPN-077 remains independent and next: integrate artwork into the
current creation surface and Storybook without waiting for or independently
rolling out that library. A selected-type facet beside today's selector is a
valid interim placement, not a permanent restriction on replacing it.

The redesigned picker covers its label, selected/disabled state, keyboard
navigation, focus return, screen-reader semantics and phone/touch interaction.
Base UI supplies behavior; the redesign chooses the visual styling with existing
theme tokens. No Tailwind adoption or wholesale UI migration is implied.

Preserve existing target sizes, focus indicators, control layout and sharing
behavior. The artwork fits inside the existing control; it does not introduce
another interactive target or a redesign of the page.

Existing authorized social cards prominently show the document's facet while
retaining Spinel branding, title bounds, emoji handling and the type label. Reuse
[the current preview pipeline](../page-identity.md): public output stays PNG,
private URLs remain generic, and no new content or identity metadata is exposed.

## Future Space surfaces

Storybook may show a clearly labeled Space creation choice, row/sidebar example
and social-card fixture before the feature is implemented. These are design
examples, not working product routes. Do not add an enabled Create Space action,
fake permission behavior or an unprotected public preview endpoint.

The later Space implementation consumes the approved artwork. Its sidebar and
sharing layouts require their own playbook coverage; this page defines icons,
not Space behavior. The static Storybook social gallery continues to render its
images at build time without deploying a server.

## Review

SPN-077 includes component/state stories plus light, dark and phone-width PR
screenshots of changed surfaces. Owner visual approval is required before merge.
Keep existing social access/revocation and long-title tests; add meaningful
checks for the new type mapping and SVG accessibility rather than pixel tests
that merely repeat path data.

## Implementation and review fixtures

`src/ui/entityIconGeometry.ts` is the shared geometry and raw SVG exporter;
`EntityIcon.tsx` renders those same paths with theme variables. The Storybook
lineup offers downloadable standalone SVGs with resolved colours. Creation,
owned/shared files, pins, search and trash use decorative icons beside labels.
`Identity/Entity icons` covers sizes, monochrome, accessible standalone images
and future Space placement; `Identity/Social cards` uses the real PNG renderer
at build time, including the static Space sample. No new dependency or rendering
service is needed. The app's heart logo and favicon remain unchanged.

Storybook CI captures these stories and the actual dashboard integration stories
in light, dark and phone layouts as the `entity-icon-screenshots` artifact. The
same ticket implements both artwork and current-surface integration (#122).
