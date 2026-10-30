# SPN-065 visual evidence

These are actual production-editor captures, not mockups. Capture date:
2026-10-30. Application source: `01eb819a972b3119bac5be3b415ce112b5ed8e92`;
the final review candidate retains identical application code. The capture/test
harness is `e2e/copy.spec.ts`, blob `866da4919f94f5d7e5029854e228286e1e16e927`.

The combined production run passed both copy journeys in 16.9 seconds under the
2 GiB process-tree watchdog, with peak RSS 1,703,984 KiB. Chromium phone emulation
uses real touch input at 390 × 844; it is not a physical-device result. The desktop
viewport is 1280 × 900. These local captures use the production build and isolated
port 32165. Full CI/check/review identities and finding dispositions are maintained
in [PR #221](https://github.com/mxbaylee/spinel/pull/221).

| Files | Theme / viewport | State |
| --- | --- | --- |
| `native-sheet-dialog-desktop-light.png`, `native-sheet-dialog-desktop-dark.png` | Light/dark, 1280 × 900 | Owned Sheet, native copy dialog, default current owned folder, saved content and independent native image fixture. |
| `native-doc-viewer-menu-phone-light.png` | Light, 390 × 844 | Shared Doc viewer, Make a copy in the native editor More menu; no Edit action. |
| `native-doc-viewer-dialog-phone-light.png`, `native-doc-viewer-dialog-phone-dark.png` | Light/dark, 390 × 844 | Shared Doc viewer, native bottom drawer, default My files destination and private ownership explanation. |
| `native-doc-copy-result-phone-light.png`, `native-doc-copy-result-phone-dark.png` | Light/dark, 390 × 844 | Reopened native drawer after dismissing an in-flight copy: retained Created/Open copy result, exactly one POST. |

The action/dialog and retained result are captured before continuing the same
asserted real-editor journeys. Both independent nonimplementing reviewers inspect
the selected images; the final PR records their reviewed SHA and approval.
Visual assessment is **agent review only**.
