# Connection status

SPN-042 implements the network control approved in SPN-047, beside the gem in
the account shell and the identity-free guest header. It is one connection
indicator, separate from the editor's save confirmation. Owner direction,
2026-10-19 and 2026-10-21; [design decision #126](https://github.com/mxbaylee/spinel/issues/126)
and [runtime decision #132](https://github.com/mxbaylee/spinel/issues/132).

## What each state proves

| State        | Meaning                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Online       | The current account screen has received a valid server health response, or the live editor has an active collaboration unit and its document room is joined. It does not prove an edit is saved.       |
| Offline      | The browser reports no connection, a bounded reachability check fails, or the editor reports its connection unavailable. Pending work stays subject to the separate save warning and navigation guard. |
| Reconnecting | The browser has returned or the connection is being established, but the relevant server/room proof has not completed.                                                                                 |

The browser's `online` event invalidates the old room proof. A good HTTP response
or an ordinary synchronization callback cannot turn a reconnecting editor Online;
the public per-document room stream must report its new subscription. Pending
edits normalize to an active collaboration unit and can coexist with Online.
No connection transition clears the pending-edit guard or bypasses the existing
recovery-cache flush that precedes a completed save.

Account screens without a live editor reuse authenticated `/api/health` with
`no-store`, a three-second poll and a two-second deadline including the body.
Probes do not overlap; old responses after browser loss, replacement or disposal
are ignored. A confirmed 401 locks the prepared-account pointer and signs in
again. Live editors stop this shell probe and use their own public room/sync
streams, plus the existing document-access round trip with a bounded timeout.
HTTP recovery requires a fresh room subscription. This is connection status for
people using Spinel, not the Operator health dashboard from SPN-032.

Guest views use only guest-scoped metadata and collaboration endpoints. They
show no account identity, account navigation or account health/session request.
Transient network errors preserve the mounted editor and unfinished changes;
authoritative 401/403/404 link denial removes document content and title.
The generic service-worker offline launch remains unchanged and never caches a
private guest document.

## Presentation and local catalogs

`ConnectionStatus` reserves a 44 by 44 px button beside the gem. Distinct icons,
an accessible state name and the same hover, keyboard-focus and touch detail
communicate the state without relying on colour. A separate polite live region
announces transitions. The detail opens outside document flow, so it cannot
move the editor, and Escape/outside touch dismiss it.

When a catalog is local, offline or a refresh failed, the detail includes
**Files as of**. SPN-042 removes `OfflineBanner`; it does not add another status
row. A local session remains read-only after verified connectivity returns,
and keeps its timestamp and read-only explanation until reopened online.
The dashboard never claims **Saved on this device**. See [offline behavior](offline.md).

The existing save row reserves Retry space through ordinary connection changes,
while keeping explicit pending-edit warnings. SPN-043 still owns the shared
title-adjacent save slot, full error detail and Retry popover; SPN-049 composes
that slot and this connection control into its wider header migration.
SPN-053 later adds local/pending-sync durability states, without treating an
open connection as persistence evidence.

## Verification and decision record

- `src/ui/connectionState.test.ts` covers browser/room/sync mapping, stale room
  proof, ordinary pending edits, health errors/timeouts, stale responses, session
  denial and disposal.
- `e2e/connection-status.spec.ts` exercises the real dashboard, Sheets and Docs
  at desktop and touch-phone widths. It holds real writes while Online, interrupts
  actual sockets, withholds a real successful JOIN response while HTTP health is
  already good, then releases it. It compares the complete editor bounds through
  Offline, Reconnecting and Online.
- Existing guest and offline end-to-end tests preserve revocation/privacy,
  unfinished guest input, local read-only copies and the catalog timestamp.
- `Current production/Shell/ConnectionStatus` stories cover all three states,
  keyboard/touch detail, stale/local catalogs and Online with an unsaved warning.
  The Storybook review captures them in light, dark and phone variants.

These are verification contracts; the PR records the actual executed commands,
results, resource limits, independent review and owner screenshot approval.
The all-persona tradeoff and S-to-M effort reassessment are in decision #132.
