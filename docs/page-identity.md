# Page identity and social previews

Spinel uses the existing faceted-heart app icon for its SVG favicon, 32px PNG and
ICO fallback. The filled background keeps it legible on light and dark browser
chrome. The service worker serves the same SVG while offline without creating a
cache. Installation icons and the manifest retain their original roles.

## Private pages and shared links

Private pages carry the generic title **Spinel**, description **Your private
workspace for documents and spreadsheets.**, and a branded 1280×640 social card.
Signed-in document tabs become **<name> — Spinel** only after authorized client
loading, and reset on navigation/unmount. All app HTML includes `noindex`; access
control still protects documents. The fallback page is **Spinel — Offline**.

Creating a guest link automatically enables a branded social card with the
**document title and Document/Spreadsheet type**, for both view and edit links.
There is no separate opt-in. Server metadata and the image expose no owner,
contents, collaborators or other documents. Private item URLs stay generic.
Owner, chat 2026-10-20, superseding SPN-044's earlier generic-only preview rule;
[decision #109](https://github.com/mxbaylee/spinel/issues/109).

A new share address has two independent random capabilities: `?preview=…` allows
only title/type preview, while `#…` grants the existing document access. Only
hashes are stored. The document capability is still absent from HTTP request
URLs/referrers. Preview tokens cannot create guest sessions, read contents or
edit. The query is removed with the fragment after the guest browser exchanges
the link; copy the original address from Share when sending it to others.

Both metadata and image requests check the current link, owner and trash state.
Rotation, link-off, trash and disabled owners stop serving the old preview; image
rendering rechecks after its asynchronous work. Personalized responses are
`no-store`, share pages are `no-referrer`, and there is no image cache. A receiving
chat service may nevertheless retain a preview it already fetched; Spinel cannot
recall external copies. Older fragment-only links still open their documents and
show the generic card until the owner creates a replacement link.

Public image URLs use configured `APP_ORIGIN`, never an incoming Host header or
request-supplied title. No canonical/Open Graph URL replaces the supplied address.
Chat apps decide whether/how to unfurl; this is a preview, not a document embed.
See [Sharing](sharing.md) for the document permission boundary.

## Artwork and verification

`node scripts/social-preview.ts` regenerates the generic image from the existing
gem/palette. Commit the PNG after visual review; its generator uses the machine's
Arial/Helvetica/sans-serif fallback. Personalized cards reuse that artwork and
render a bounded title/type with existing Sharp and a bundled OFL-licensed
[Atkinson Hyperlegible and Noto Color Emoji fonts](../src/ui/fonts/README.md).
Titles wrap within a fixed area and shorten to 64 grapheme clusters with an
ellipsis, preserving whole emoji sequences. Full HTML titles are unchanged.
No browser font changes,
external rendering service or new npm package is required. Native image rendering
is capped at two concurrent requests, with no unbounded queue or per-link cache.

The Operator gets a bounded deployment, the Owner gets automatic recognizable
shares, the Collaborator retains content/identity privacy, and the Link guest
keeps scoped document access. Tests cover metadata in development/production,
preview/content-token separation, rotation/revocation, async revocation, trash,
disabled owners, title escaping, image loading offline, and client tab names.
Browser review fixtures show the actual generic, Doc and Sheet assets in light,
dark and phone surroundings; they are not new product screens.

[Open Graph](https://ogp.me/) defines the metadata and image alt text.
[GitHub's preview guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
provides the 1280×640 reference. [Sharp's text API](https://sharp.pixelplumbing.com/api-constructor/)
provides bounded text rendering. Sources consulted 2026-10-20; artwork is Spinel's.

Storybook's **Identity / Social cards** gallery includes generic, Doc, Sheet,
emoji, long-title and unbroken-word examples. Its Vite build invokes the actual
server renderer once per example and embeds PNG data in the static stories.
The published catalogue has no server routes or rendering runtime. Restart
Storybook after changing the renderer to regenerate its examples.
