# Item appearance

Docs, Sheets and Spaces always have an identity icon. Creation offers the same
searchable picker for icons and emojis as editing appearance later. Names,
keywords and common typos search both kinds together; pasting one emoji selects
that exact character, including skin tones and joined sequences. The Emojis
category narrows browsing. Leaving the choice
untouched, or using Reset icon, uses the NFC-normalized filename hash and the
existing flower/plant palette. A custom icon persists through rename. Folders
keep a folder glyph by default. Selecting a line icon for any item exposes
**Icon color** beside the identity choice, using a small rounded tile and contrasting paired ink from the existing theme-aware fill
presets. Creation and editing share the control, show the selected color in the
preview, and persist it across lists, editor headers and offline copies. Reset
color restores the inherited color without changing the icon. Emojis retain
their native colors and hide the tint controls; returning to a line icon reuses
the saved color. Earlier saved folder colors remain readable as icon colors;
type, access and save indicators remain separate from identity.

Appearance lives in item metadata, independent of native document snapshots.
Outer files and Space roots use owner/file-admin metadata authority. Space
children use the existing Space edit authority, including an editor link within
that exact Space. Ordinary document link guests cannot change metadata. All
reads, asset reads and writes recheck current account/link access; an Operator
has no document access. Open appearance dialogs detect conflicting revisions
instead of overwriting another device's changes.

## Page covers

Docs and Sheets, standalone or inside Spaces, have independent page covers.
The cover sits above the title and scrolls completely out of view while the
native editor stays mounted. The picker has one viewport-bounded height across
**Gems / Upload / Unsplash**, with a stable preview, position and action area.
Only the options scroll on ordinary-height screens; the complete picker can
scroll on short screens. Failed replacements preserve the saved cover.

Gems always follow the active light/dark mode; the only choice is the gem name.
Uploads and Unsplash offer one shared
image or a light/dark pair, with deliberate colors and a vertical crop control.
Theme changes select an existing variant and never rewrite saved appearance.

The preset order is Ruby, Jasper, Yellow Diamond, Peridot, Sapphire, Lapis,
Amethyst, Spinel, Rose Quartz, Pearl, Obsidian and Bismuth. Gem shapes echo into
nearby background facets, and left-aligned crops retain the focal gem at every
width. Spinel alone reverses its heart and background orientation in dark mode.
The original approved light Spinel remains unchanged. See the
[reference artwork and per-pair rubric](review/spn-086/README.md).

## Upload and provider boundaries

Uploads accept static PNG, JPEG or WebP up to 8 MiB and 16 megapixels. The server
fully decodes, strips metadata, rotates and normalizes to WebP up to 4096 px.
An item may retain at most 16 MiB across variants; a current owner may retain
100 MiB. Storage-reducing changes remain possible after ownership transfers
exceed quota. Transfer admission and decode concurrency bound transient memory.
Assets are content-hashed, item-scoped database blobs served through authorized,
no-store routes. Replacement/removal deletes unreferenced cover blobs in the
same transaction. Trash retains them; restore returns them; permanent deletion
cascades. Ownership handover follows the current item's owner automatically.

Live Unsplash search requires the server environment variable
`UNSPLASH_ACCESS_KEY`. Without it the picker reports that it is unavailable and
offers Gems or Upload. The server searches and resolves selected IDs, validates
provider hosts, preserves returned image hotlinks and reports the provider's
selection/download event. Provider errors never replace the previous cover.
Search and result bytes are bounded. The private selection metadata follows
item permissions; Unsplash photographs themselves are public provider content.

Attribution is small white text over the image, with a subtle shadow and **no
badge background**. Photographer and Unsplash links remain available on keyboard
and touch. Search results also credit their photographer and Unsplash. Links use
`utm_source=spinel&utm_medium=referral`. Provider images are never proxied into
private upload storage. See the [attribution decision](../implementation/SPN-086.md#quiet-photo-attribution).

## Space accents and offline behavior

Space accents change navigation, application controls and browser text-selection
foreground/background colors. Native editor surfaces and authored formatting
retain the base theme. Leaving a Space restores the active theme's Spinel tokens;
semantic success/warning/error colors and exports remain unchanged. Covers are
independent of accents.

Account-only offline downloads include appearance metadata and uploaded cover
bytes, verified by hash before the atomic device save. Gems render locally.
Unsplash covers show a connection-required placeholder offline, without a remote
fallback. Removing a downloaded document removes its saved cover too. Existing
offline revocation policy applies to account copies; guests cannot download.
Native file exports omit decorative appearance, while full database backups
retain it.

## Review surfaces

**Redesign / Appearance / Playground** uses the production controls with local,
explicitly labeled save fixtures. Controls switch item kind, starting gem and
save failure. Upload fixture bytes remain local; live Unsplash is exercised in
the application. **Gems Light And Dark** displays every artwork pair with desktop
and phone crops. Production browser tests capture current editor and picker
screens in light, dark and phone widths. Agent visual review is independent of
owner approval; the PR records current-commit scores and findings.
