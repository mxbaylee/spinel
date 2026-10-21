# Third-party notices

Code copied or adapted from other projects, with its source, license and what
changed. Dependencies installed from npm are not listed here; their licenses
ship with them.

| Path in Spinel | Source | License | Changes |
| --- | --- | --- | --- |
| `scripts/dependencies/patch-univer-core.ts` | [dream-num/univer core paragraph composition](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/utils.ts) and [operation slicing](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/action-iterator.ts), v1.1.0 | Apache-2.0 | Preserve paragraph REPLACE semantics and explicit empty arrays through operation slicing in pinned ESM/CJS builds; retain stable paragraph IDs and license notices |
| `lib/sync-transform/src/univer-merge.ts` | [dream-num/univer sheets SetRangeValuesMutation](https://github.com/dream-num/univer/blob/v1.1.0/packages/sheets/src/commands/mutations/set-range-values.mutation.ts), [cell styles](https://github.com/dream-num/univer/blob/v1.1.0/packages/sheets/src/basics/cell-style.ts) and [NumfmtService](https://github.com/dream-num/univer/blob/v1.1.0/packages/sheets/src/services/numfmt/numfmt.service.ts), v1.1.0 | Apache-2.0 | One cell held as data instead of in a worksheet: inline styles instead of the style table, no style sanitizing, numfmt handlers for one cell; retains the license notice |
| `src/server/auth/passkey-provider-names.json` | [passkeydeveloper/passkey-authenticator-aaguids](https://github.com/passkeydeveloper/passkey-authenticator-aaguids) at `774b3cf`, via circus-health | Factual name mappings | Names only; icons dropped |
| `docs/reference/icons/person-icon-catalog.json` | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) icon metadata at `a79b2d1`, via circus-health | ISC (Lucide, which also keeps MIT notices for icons derived from Feather) | Tags and categories only |

Code from [mxbaylee/circus-health](https://github.com/mxbaylee/circus-health) isn't listed:
Baylee Schmeisser, Spinel's owner, wrote it.

When SPN-036 moves the icon metadata into `src/`, update its path here.

When adding an entry:

- Keep the original copyright and license header in each copied file.
- Add a line in the file saying it was modified for Spinel.
- List it here as: path in Spinel, source repository and commit, license, and a
  one-line summary of the changes.
