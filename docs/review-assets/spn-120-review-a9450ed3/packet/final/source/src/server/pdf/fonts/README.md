# PDF runtime fonts

These unmodified, static SFNT files ship with Spinel's isolated PDF worker. No
system font scan, operating-system font package, credential or network request
participates in PDF rendering. Licenses remain beside the original font bytes.

## Sources

- **Liberation 2.1.5**, Sans, Serif and Mono, regular/bold/italic/bold-italic:
  [upstream release](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5),
  [original archive](https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz).
  Archive SHA-256: `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`.
  SIL Open Font License 1.1 in [Liberation-OFL.txt](Liberation-OFL.txt).
  The project aims for metric compatibility with Arial, Times New Roman and
  Courier New; these remain substitutions, not licensed copies of those fonts.
- **Atkinson Hyperlegible**, regular/bold/italic/bold-italic: Google Fonts
  [`95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/atkinsonhyperlegible`](https://github.com/google/fonts/tree/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/atkinsonhyperlegible).
  Copyright 2020 Braille Institute of America, Inc.; SIL OFL 1.1 in
  [Atkinson-OFL.txt](Atkinson-OFL.txt). These are byte-identical to the existing
  print-package fixtures; their runtime selection is now explicit.
- **Noto Sans Symbols 2**, regular: Google Fonts
  [`95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/notosanssymbols2`](https://github.com/google/fonts/tree/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/notosanssymbols2).
  Copyright 2022 The Noto Project Authors; SIL OFL 1.1 in
  [NotoSymbols-OFL.txt](NotoSymbols-OFL.txt). This is a symbol fallback, not
  universal Unicode, emoji or script support.

## Selection policy

Unspecified text and Arial use Liberation Sans. Times New Roman uses Liberation
Serif and Courier New uses Liberation Mono. The explicitly listed generic/common
sans, serif and monospace aliases in `../fonts.ts` use the same three families.
Their metrics can differ from the browser's installed face; layout is recomputed
in full, with clipping and glyph coverage checked before output is released.
Atkinson Hyperlegible keeps its own four faces. Noto Sans Symbols 2 provides
regular-symbol fallback. Unknown families and missing glyph/style combinations
fail the complete export instead of producing invisible or missing text.

Each disposable worker loads this fixed seventeen-face bank: four complete
families and the regular symbol face. The native text projection, which already
owns effective style resolution and worksheet/axis selection, admits the families
that are actually used. Unused named styles, unselected sheets and hidden cells
therefore cannot reject an otherwise supported export merely by mentioning an
unbundled family. A used unbundled family still fails explicitly; no universal
Sans substitution is applied.

The face ceiling is seventeen to admit exactly this existing bank. The runtime's
12 MiB font-byte budget and all process/container memory limits remain unchanged.
The container's existing `src` copy includes these assets and notices.
