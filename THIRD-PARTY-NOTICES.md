# Third-party notices

Code copied or adapted from other projects, with its source, license and what
changed. Dependencies installed from npm are not listed here; their licenses
ship with them.

| Path in Spinel | Source | License | Changes |
| --- | --- | --- | --- |
| `scripts/dependencies/patch-univer-core.ts` | [dream-num/univer core paragraph composition](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/utils.ts) and [operation slicing](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/action-iterator.ts), [custom range merging](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/apply-utils/common.ts) and [updates](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/apply-utils/update-apply.ts), [adding a custom range](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/build-utils/text-x-utils.ts), and [text style transforms](https://github.com/dream-num/univer/blob/v1.1.0/packages/core/src/docs/data-model/text-x/transform-utils.ts), v1.1.0 | Apache-2.0 | Preserve paragraph REPLACE semantics and explicit empty arrays through operation slicing in pinned ESM/CJS builds; retain stable paragraph IDs and license notices; join and rename custom ranges after every update; never emit a negative retain when adding a custom range; let a winning REPLACE text style's falsy keys override a concurrent COVER style |
| `scripts/dependencies/patch-univer-ui.ts` and `.test.ts` | [dream-num/univer virtual-list hook](https://github.com/dream-num/univer/blob/v1.1.0/packages/ui/src/views/hooks/virtual-list.ts), v1.1.0 | Apache-2.0 | Ignore queued resize callbacks after the DOM ref detaches in pinned ES/CJS builds; preserve normal measurements and license notices; retain the original measurement as a negative regression control |
| `src/server/auth/passkey-provider-names.json` | [passkeydeveloper/passkey-authenticator-aaguids](https://github.com/passkeydeveloper/passkey-authenticator-aaguids) at `774b3cf`, via circus-health | Factual name mappings | Names only; icons dropped |
| `src/profile/person-icon-catalog.json` | [lucide-icons/lucide 1.59.0 metadata at `1ef60af944de207e0d5176905a0759ba12e6ee8d`](https://github.com/lucide-icons/lucide/tree/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons); unmatched legacy rows retain the original [`a79b2d131dab2bf20cb224bd0937b439a9c4fa99` metadata](https://github.com/lucide-icons/lucide/tree/a79b2d131dab2bf20cb224bd0937b439a9c4fa99/icons), via circus-health | ISC (Lucide, which also keeps MIT notices for icons derived from Feather) | Tags and categories only; canonical metadata refreshed while preserving all saved names and unmatched legacy rows |

The unmodified `src/ui/fonts/AtkinsonHyperlegible-Bold.ttf` comes from
[Google Fonts at 95f4904](https://github.com/google/fonts/tree/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/atkinsonhyperlegible).
Its SIL Open Font License 1.1 and copyright are retained in `src/ui/fonts/OFL.txt`.
It supplies server-rendered shared-card text only. The unmodified
`src/ui/fonts/NotoColorEmoji.ttf` comes from
[Google Noto Emoji v2.051](https://github.com/googlefonts/noto-emoji/tree/6202fe7c20dd5e1727a4c3c01604edc176c576da/fonts),
with its SIL Open Font License 1.1 and copyright in `src/ui/fonts/NotoEmoji-OFL.txt`.
It supplies server-rendered title emoji on hosts without system fonts.

The unmodified PDF test font fixtures in `lib/print/test-fixtures/fonts/` include
Atkinson Hyperlegible Regular/Bold/Italic/BoldItalic from the same pinned Google
Fonts revision above, and [Noto Sans Symbols 2 Regular at that revision](https://github.com/google/fonts/tree/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/notosanssymbols2).
Their SIL Open Font License 1.1 texts and copyrights are retained beside the
files in `Atkinson-OFL.txt` and `NotoSymbols-OFL.txt`. These are explicit test
inputs for prepared-font validation, not production font substitutions.

Code from [mxbaylee/circus-health](https://github.com/mxbaylee/circus-health) isn't listed:
Baylee Schmeisser, Spinel's owner, wrote it.

When adding an entry:

- Keep the original copyright and license header in each copied file.
- Add a line in the file saying it was modified for Spinel.
- List it here as: path in Spinel, source repository and commit, license, and a
  one-line summary of the changes.
