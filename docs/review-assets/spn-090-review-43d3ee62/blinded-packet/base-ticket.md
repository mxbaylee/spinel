---
id: SPN-090
emoji: 🧪
effort: XL
impact_owner: M
impact_collaborator: M
score: 23
depends_on: []
decisions: []
---

# 🧪 SPN-090 Verify offline launches on real phones

## Story

As the [Owner](../product/personas.md#owner), I want downloaded Docs and Sheets to survive an ordinary phone-app restart offline, so that a home-screen launch is trustworthy away from a connection. Signed-in [Collaborators](../product/personas.md#collaborator) get the same within their permissions.

## Scenarios

### Download, terminate, launch and reconnect

Given I downloaded a Doc and Sheet with existing images in the launch context,
When I terminate it, enable airplane mode, open the home-screen entry, edit, and close/reopen offline,
Then the complete documents and committed local edits remain available, and reconnecting syncs them once when unchanged or preserves a conflicted copy when the live document changed.

### A shortcut is not a download

Given I have a stable item link but no complete download in that browser/app context,
When I launch it offline,
Then Spinel says it needs a connection rather than claiming the shortcut made the document available.

## Rules

- Current verification combines targeted installed-lifecycle observations on the owner's Pixel 10/Chrome/Home Screen with current deterministic/shared native content, persistence, replay and authority checks. This supersedes the former repeated three-platform physical matrix, capability harness and BrowserStack/monthly/quota requirements. The owner removed BrowserStack on 2026-11-13; this is no paid-device authorization. Preserve old requirements/results as historical provenance, not current execution instructions. [Current method and limits](../implementation/SPN-090.md#-current-phone-verification-method), agent reconciliation, 2026-11-14.
- Accept lower integrated phone confidence explicitly: exact phone OS/browser version and tested build are unknown, the final known-offline sign-in shortcut was not phone-retested, and the notes do not prove every physical edit/reopen/replay/creation permutation. Never attach today's SHA to those observations or call emulation an installed phone. iPhone verification remains owner-deferred post-launch [SPN-152](SPN-152.md).
- Complete outcome stays **XL**: accumulated installation/storage investigation, shell/startup repairs, account/runtime persistence, native editor evidence, integration and visual/hosted verification. Provider removal does not shrink that full outcome or complete the still-open PR. Retain original failures, including provider data loss of unknown cause.
- Candidate `67111d9c` failed recovery after restore commit and before intended SIGKILL. [SPN-158](../implementation/SPN-158.md) has landed the distinct admission fixture repair; integrate it and obtain this ticket's own current-head acceptance. No old failed gate is relabelled a pass. [Recorded boundary](../implementation/SPN-090.md#-restored-admission-prerequisite).
- Image paste [SPN-154](SPN-154.md) and editor-independent file-list replay [SPN-156](SPN-156.md) retain their full scope as **pre-launch** work. Closing SPN-090 completes neither. SPN-156 retains its own bounded repaired-build installed-phone reconnect observation; this method does not waive it.
- Prepare private downloads in the context that launches; never assume a Safari tab shares storage with its installed app. Keep truthful persistence feedback, complete downloaded content/images, installed icons and offline manifest. SPN-055 supplies shared storage/account/runtime lifecycle; SPN-052 separately owns ordinary desktop compatibility.
- Rename/move preserves ordinary `/?item=<uuid>` and exact account Space-child `/spaces/<spaceId>?item=<itemId>` targets. An unavailable explicit child never opens another page. A shortcut means neither prepared content nor a whole-Space download; unsupported item icons use stable-link/offline-collection fallbacks. Personal pins remain removed.
- Retain SPN-051 creation: create/edit offline, reopen, reconnect exactly once, verify one server item and recover a rejected folder. Existing storage/native owners also retain lost-acknowledgement, crash-before-outbox-clear, history, account switching, viewer/revoked-access and guest/token-exclusion contracts. Record which results are physical observations versus deterministic/native evidence.
- Follow [sustainable testing](../testing.md), [production-story migration](../implementation/storybook-production-migration.md#migrate-stories-with-their-ui-tickets) and independent current-source light/dark/phone visual review for changed UI. New paid-provider work, arbitrary waits, retries or broader confidence claims are not acceptance.

## Out of scope

- Reimplementing shared storage lifecycle, desktop compatibility, native apps or closed-app/OS background synchronization; reintroducing BrowserStack or a recurring paid-device matrix.

## Verify

- Contract/owners: map every original product requirement to the retained installed observations or existing `offline`, `offline-editing`, `offline-recovery`, `offline-creation`, `offline-sign-out`, `offline-device` and `pwa` owners. Reuse `e2e/offline-fixture.ts`; deterministic controls own lost acknowledgements, replay/persistence failures and authority negatives, while actual native owners prove exact local/server/peer content and one-time replay or conflict preservation.
- Readiness/cleanup: isolate prepared accounts/items and owned resources, observe actual context/network/save readiness, preserve first failures and restore network/close sessions on owned device work. A new profile or browser viewport cannot prove same-context Home Screen relaunch. Keep current budgets and relevant offline/auth/build/harness dependencies in CI selection.
- Evidence: retain original phone notes with unknown identities intact, exact current source/run/attempt and selected results, mapped content/access assertions, unavailable or unobserved physical cases and independent visual findings. Current candidate gates, full product acceptance and separate154/156 outcomes remain required; no provider smoke or earlier successful run replaces them.
