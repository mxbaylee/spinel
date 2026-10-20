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
other devices. This is Sheet touch support; it does not promise a separate phone
interface for Docs (SPN-072). Univer currently describes its
mobile UI as experimental.

## Connection loss

On a device not prepared for offline use, opening Spinel without a connection
shows a generic offline page with a Try again button. It contains no document title,
content, account information or share token. Retry reloads the original address
after the connection returns; the server checks access again.

Signed-in accounts can keep selected documents on a device
([docs/offline.md](offline.md#offline-launch-and-read-only-viewing), SPN-039).
On a prepared device the service worker also caches the public app shell, so
Spinel opens offline with the last-synced file list and downloaded documents open
read-only. Pages that need the server, guest links and unprepared devices still
get the generic offline page above. Offline editing and real-device runs are
SPN-053 and SPN-055. The earlier global no-offline-feature policy is superseded
for this feature, while guests keep the generic fallback ([decision #83](https://github.com/mxbaylee/spinel/issues/83)).

An editor already open when connectivity drops retains its existing unsaved-edit
warning. Keep that tab open until changes are saved. Installing Spinel does not
make pending edits durable on the phone or make it safe to close an unsaved tab.

The service worker never puts authenticated HTML, API responses, snapshots,
images, guest pages or link tokens in CacheStorage. Navigation goes to the network
with caching disabled; only a network failure produces the fixed offline page.
HTTP authorization errors are returned unchanged. Public icons and the worker
code are safe to retain; no private offline cache or sync queue is introduced.

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
  service-worker-cache private data: offline privacy #23, guest isolation #72 and
  grooming, 2026-10-18.
- Touch gestures come from Univer's renderer; Spinel selects its public UI
  plugins and adapts controls. Install icons reuse SPN-027's heart: grooming #60,
  2026-10-18. Choose controls once per editor and preserve privacy with network-only
  navigation: [decision #82](https://github.com/mxbaylee/spinel/issues/82).
- Test configured HTTPS now and repeat at the approved public origin during
  SPN-038; guest access stays document-only: #72 and grooming, 2026-10-18.
- Current Chromium installability, manifest/icons and offline privacy checks
  replace the deprecated Lighthouse PWA audit: [decision #77](https://github.com/mxbaylee/spinel/issues/77),
  2026-10-18.

Public SDK guidance: [mobile installation](https://docs.univer.ai/guides/sheets/getting-started/installation#mobile-support).
