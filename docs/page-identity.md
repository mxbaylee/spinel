# Page identity and social previews

Spinel uses the existing faceted-heart app icon for its SVG favicon, 32px PNG and
ICO fallback. The filled background keeps it legible on light and dark browser
chrome. The existing installation icons and manifest retain their original roles.
The service worker serves the same SVG while offline without creating a cache.

Every server-sent page has the generic title **Spinel**, the description **Your
private workspace for documents and spreadsheets.**, Open Graph metadata and a
large-image social card hint. The social card is a fixed 1280×640 PNG using the
existing gem, light palette and system typography. `node scripts/social-preview.ts`
regenerates `src/ui/social-preview.png`; commit the result after visual review.
Production serves the committed image, so it needs no fonts or rendering service.
The generator uses the machine's Arial/Helvetica/sans-serif fallback; inspect its
output if regenerating on another platform.

The public image URL comes from the configured `APP_ORIGIN`, never the incoming
Host header or document metadata. The image is public and credential-free.
Previews never contain document names, owners, contents, account information or
share tokens, even for a valid guest link. No canonical or Open Graph URL replaces
the supplied guest address, whose fragment carries its capability. Chat apps choose
whether and how to unfurl a link; Spinel supplies standard metadata, not an embed
of the document. Guest links themselves are described in [Sharing](sharing.md).

All app HTML includes `noindex`; access control still protects the documents.
Signed-in document tabs become **<name> — Spinel** only after client-side loading;
folder/dashboard tabs and unmounted document views reset to **Spinel**. Guest and
server HTML titles remain generic. The offline fallback is **Spinel — Offline**
and uses the same favicon.

These rules preserve the Operator's small deployment, the Owner's recognizable
workspace, the Collaborator's private information and the Link guest's scoped
access. Owner, chat 2026-10-20; [decision #109](https://github.com/mxbaylee/spinel/issues/109).
The layout uses the existing [design tokens and gem](design/README.md), with no new
interactive component or product screen. Review fixtures show the actual public
assets in light, dark and phone-width surroundings.

The [Open Graph specification](https://ogp.me/) defines the image metadata and alt
text. [GitHub's social preview guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
provides the 1280×640 image size reference. Sources consulted 2026-10-20; the artwork
is Spinel's, not copied from GitHub.
