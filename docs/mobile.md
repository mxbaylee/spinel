# Spinel on a phone

Open the configured HTTPS address, sign in, and use your browser's install or
Add to Home Screen action. The installed app uses Spinel's name and heart icon
and opens in a standalone window. Installation does not create an account or
grant access: passkeys, account permissions and document-only guest links keep
their normal boundaries.

Sheets choose Univer's mobile controls when opened with a coarse pointer on a
screen up to 900 CSS pixels wide. Touch the canvas to select cells; double-tap a
cell to edit, then use OK to commit. Pan and pinch use Univer's renderer. The
control mode stays fixed while that editor is open, so rotating the screen does
not recreate an editor containing unsaved changes. Desktop controls remain on
other devices. Univer currently describes its mobile UI as experimental.

## Docs

Docs choose the public mobile UI with the same coarse-pointer/900px rule, once
per open editor. Ordinary (modern) Docs wrap to the phone's width at a local
reading scale while keeping their stored page settings and desktop zoom. Tap
**Edit**, then touch the text to write. The native compact toolbar provides
formatting and headings when the keyboard is open; its **More** menu offers
ordered and unordered list styles. Hold a word to select it, then use **Bold** or
**Italic** in the selection menu. Opening a Doc does not open the keyboard.
Rotate the device or enter theatre mode without
recreating the document. People stays available, and Share and Formula insertion
remain in More according to the current account or guest permissions.

Docs with a traditional page layout keep that layout and are read-only on a
phone, with **“Edit on a larger screen. This Doc keeps its page layout.”** This
avoids changing shared page dimensions merely to fit a device. Formula results
remain readable in their existing dialog, including all rows of table results;
insertion and editing require an editable modern Doc. History uses the same
mobile presentation and remains read-only. Downloaded offline copies use the
live native editor with their saved permissions and SPN-053's durable local
queue; modern Docs with an edit grant remain editable, while viewer downloads
and traditional phone Docs remain read-only. Offline Formula results are
unavailable, as described in [offline editing](offline.md#how-offline-editing-works).

If a collaborator changes the Doc's page mode while it is open, the phone keeps
pending edits and switches to a local view-only state. Wait for those edits to
save, then reopen the Doc as the on-screen note requests. Reopening initializes
the native controls for its current page mode.

The [owner's SPN-072 acceptance revision](implementation/SPN-072.md#owner-revision-responsive-browser-acceptance)
(2026-10-26, America/Los_Angeles) accepts responsive browser testing for this
change. The native Storybook and browser suites check readable reflow, saved
settings, touch-event editing, exact persistence, formatting, Formula dialogs,
viewer boundaries and the caret under an emulated keyboard-sized inset; see
the [source verification and its limits](implementation/SPN-072.md#verification-boundaries).
Physical iPhone and Android checks remain **Not run**. They provide follow-up
confidence and are not a merge prerequisite for SPN-072. Browser emulation does
not establish actual software-keyboard, physical touch or IME behavior.

| Physical device | OS/browser versions | Doc reading, selection, keyboard, formatting and IME |
| --------------- | ------------------- | ---------------------------------------------------- |
| iPhone          | Not recorded        | Not run                                              |
| Android phone   | Not recorded        | Not run                                              |

When devices are available, record device model, OS/browser version,
installed-app/browser mode, commit, date and result. On each device open a
populated modern Doc; read long paragraphs;
type with its software keyboard; move/extend a selection across wrapped lines;
apply bold, a list and a heading; compose non-Latin text with an IME; confirm the
caret and controls remain above the keyboard; rotate; save and reopen. Check
Formula scalar/30-row results and insertion/editing, then repeat viewing through
an anonymous viewer link and verify it cannot edit. Confirm a traditional Doc
shows the larger-screen note and keeps its saved/exported layout. Record failures
with exact steps; do not mark the check passed from an emulator screenshot.

## Connection loss

On a device not prepared for offline use, opening Spinel without a connection
shows a generic offline page with a Try again button. It contains no document title,
content, account information or share token. Retry reloads the original address
after the connection returns; the server checks access again.

Signed-in accounts can keep selected documents on a device
([docs/offline.md](offline.md#offline-launch-and-read-only-viewing), SPN-039).
On a prepared device the service worker also caches the public app shell, so
Spinel opens offline with the last-synced file list and downloaded documents open
with their saved permissions. SPN-053 uses the native Sheet/Doc editor and a
durable local queue; **Saved on this device** follows its storage commit, and
**Synced** follows server acknowledgement plus local cleanup. Viewer downloads
remain read-only. Pages that need the server, guest links and unprepared devices still
get the generic offline page above. Physical-device verification remains
SPN-090, with shared storage lifecycle in SPN-055. CI phone viewports do not prove
installed Android/iPhone behavior. The earlier global no-offline-feature policy is superseded
for this feature, while guests keep the generic fallback ([decision #83](implementation/SPN-039.md#legacy-decision-83-complete-opted-in-offline-product)).

An editor already open when connectivity drops retains its existing unsaved-edit
warning until its changes are saved. Explicitly downloaded documents can confirm
local durability through **Saved locally**; undownloaded editors must stay open
until saving succeeds. Installing Spinel alone does not download a document or
make its pending edits durable on the phone.

The service worker never puts authenticated HTML, API responses, snapshots,
images, guest pages or link tokens in CacheStorage. Navigation goes to the network
with caching disabled; only a network failure produces the fixed offline page.
HTTP authorization errors are returned unchanged. Public icons and the worker
code are safe to retain. Explicit downloads use the separately scoped IndexedDB
store and queue described above, rather than private data in CacheStorage.

## Verification and deployment

`npm run e2e` runs development and production tests, then a separate
`mobile-https` project using a disposable HTTPS server on loopback port 3103.
Its temporary certificate and database are test-only. The fixture forwards real
application HTTP and WebSocket handlers with the HTTPS origin configured; it
does not change production TLS or origin validation. The test browser alone
accepts that certificate.

The mobile suite checks current Chromium installability, the manifest, real
touch editing/pan/zoom, persisted values, unsaved-edit warnings, reconnect and
generic offline navigation. Unit tests verify public icon dimensions and worker
network/privacy behavior. The full guest-link suite remains responsible for real
guest access and revocation; an invented offline share path proves only that the
fallback does not expose its token. Run installation again at the public HTTPS
origin during the approved SPN-038 cutover; local HTTPS evidence does not prove
public DNS, certificates or deployment readiness.

## Preserved decisions

- A manifest and a small service worker, with no offline editing feature: PRD §6
  and grooming, 2026-10-17. Keep already-open editors' unsaved warnings and never
  service-worker-cache private data: offline privacy [#23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming), guest isolation [#72](implementation/SPN-016.md#legacy-decision-72-scoped-anonymous-link-capabilities) and
  grooming, 2026-10-18.
- Touch gestures come from Univer's renderer; Spinel selects its public UI
  plugins and adapts controls. Install icons reuse SPN-027's heart: grooming [#60](implementation/grooming-2026-10-18.md#legacy-decision-60-recovery-and-organization-grooming),
  2026-10-18. Choose controls once per editor and preserve privacy with network-only
  navigation: [decision #82](implementation/SPN-028.md#legacy-decision-82-initial-mobile-and-installable-shell).
- Test configured HTTPS now and repeat at the approved public origin during
  SPN-038; guest access stays document-only: [#72](implementation/SPN-016.md#legacy-decision-72-scoped-anonymous-link-capabilities) and grooming, 2026-10-18.
- Current Chromium installability, manifest/icons and offline privacy checks
  replace the deprecated Lighthouse PWA audit: [decision #77](implementation/SPN-028.md#legacy-decision-77-maintained-installability-verification),
  2026-10-18.
- Docs use the pinned OSS public mobile plugins and a local reading scale;
  preserve shared page settings, saved/exported layout, selection, collaboration
  and viewer permissions. Do not patch the SDK or CSS-scale its native canvas.
  SPN-049's [zoom investigation](implementation/SPN-049.md#phone-doc-fit-investigation-and-supported-fallback)
  found snapshot mutation in public zoom commands, while the
  [separate view-scale route](implementation/SPN-049.md#native-phone-navigation-evidence-repair)
  supported further investigation. SPN-072's
  [public integration](implementation/SPN-072.md#public-mobile-docs-integration)
  and [local scale](implementation/SPN-072.md#saved-zoom-and-local-phone-scale)
  preserve this distinction. Univer's mobile UI remains experimental; traditional
  pages use the explicit larger-screen editing fallback to protect their layout.
- Phone chrome keeps title, save/connection status, More and a directly available
  people/count control; Share is in More, and document content must not overflow
  page chrome. Follow the [composed editor design](design/editor.md#phone) and
  SPN-047 [decision #126](implementation/SPN-047.md#legacy-decision-126-approved-redesign-and-its-limits),
  2026-10-20. Current light/dark/phone images require independent theme/persona
  review under the [standing agent policy](implementation/grooming-2026-10-26.md#agent-decisions-and-visual-review).
- Phone checks retain Formula scalar and table reading and insertion/edit dialogs,
  every result row and usable touch targets: SPN-033
  [decision #113](implementation/SPN-033.md#legacy-decision-113-live-authorized-document-formulas)
  and grooming, 2026-10-20. Read-only and traditional-layout views retain their
  existing edit restrictions.
- Preserve the exact saved-content, Online-state and visible-caret assertions
  from the [2026-10-26 CI audit](implementation/ci-reliability-2026-10-26.md#phone-doc-failures-remain-real-investigation).
  SPN-072's [reconciliation](implementation/SPN-072.md#reconciliation-with-the-main-ci-audit)
  distinguishes the retained narrow-width desktop cases from mobile integration
  evidence; a passing retry does not establish the cause or make a failure harmless.
- Responsive-browser evidence is sufficient for SPN-072 under the
  [owner's 2026-10-26 scope revision](implementation/SPN-072.md#owner-revision-responsive-browser-acceptance).
  Actual keyboard, physical touch and IME checks stay honestly unperformed in
  the checklist above. Offline storage/account lifecycle remains SPN-055, and
  physical offline launch, persistence and reconnect remains SPN-090.

Public SDK guidance: [mobile installation](https://docs.univer.ai/guides/sheets/getting-started/installation#mobile-support).
