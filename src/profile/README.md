# 👤 Profile icons

Search and vocabulary originated in mxbaylee/circus-health at 2ab77af, written by
Spinel's owner. Canonical tags and categories come from the pinned `lucide` 1.69.0
release's [metadata at `91a1359b5ea235f620ba3a9682015ab8d6ada3af`](https://github.com/lucide-icons/lucide/tree/91a1359b5ea235f620ba3a9682015ab8d6ada3af/icons).
Lucide is ISC licensed and retains MIT notices for icons derived from Feather.
Search supports aliases, synonyms, categories and typos. Only catalog values
(`lucide:<name>`) and the 16 fill preset keys may be saved.

The catalog retains all 2,159 previously accepted spellings and adds 158 names:
2,317 saved spellings resolve to 2,313 package exports. Four numeric pairs
(such as `arrow-down-0-1` and `arrow-down-01`) share an export key; both spellings
remain valid. Newly renamed icons keep their old saved names and share one search
result with the canonical name, including archive restore and exclamation-point
icons. Historical alias rows without a current metadata file keep their previous
metadata; the original legacy source is
[`a79b2d131dab2bf20cb224bd0937b439a9c4fa99`](https://github.com/lucide-icons/lucide/tree/a79b2d131dab2bf20cb224bd0937b439a9c4fa99/icons).

Lucide 1.69 metadata uses inline `$extends:` references and `$group:` modifiers.
Resolve these with the release's `resolveMetadataExtends` helper and `groups/`
data before copying tags/categories. Search must never index those marker strings.
Keep the helper's in-place ordering and first-occurrence deduplication. No
upstream resolver code is shipped in Spinel; only the resolved metadata is retained.

To update the catalog, compare the pinned package's `icons` exports with the
existing names after the same kebab-to-Pascal conversion used by `iconNodes`.
Retain every saved spelling, add missing canonical names, and copy resolved `tags` and
`categories` from the release commit's matching `icons/<name>.json`. Keep rows
without a matching metadata file unchanged; filling every historical alias from
its canonical icon would add duplicate category results. Preserve existing row
order and insert additions in upstream metadata filename order. Update the
catalog provenance and add explicit search mappings for newly renamed icons,
moving their local vocabulary to the canonical key. `profile.test.ts` checks the
complete export set, renamed drawings and avatar round trips, search deduplication,
local synonyms and all eight numeric spellings.

Profiles store names and appearance separately from passkeys. New accounts use
user-round and a name-derived preset. Settings saves are visible immediately in
the rail; reopening an editor refreshes its server-issued presence identity.

The public avatar URL contains only a catalog icon and palette key, never a user
identifier. Server-authoritative membership supplies this URL in account-only
rooms. Active guest-link rooms retain Guest/Collaborator labels and an empty
avatar, with default ID-derived colours. A generic user-round glyph in those
rooms is not a personal avatar. Both canvas labels and badges share these values.

Go to person reveals a Sheet range only when offscreen, preserving the local
selection. Docs retain native canvas presence until SPN-058. Owner, 2026-10-20.
