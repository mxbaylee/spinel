# ✅ SPN-141 handoff Firefox acceptance — reviewer A

Independent nonimplementing review; agent review only. Firefox acceptance is supported on **current source `c4e64fa110a57d70fb682649d7f4d45ca3d20951`**, with no findings. This uses the new execution, not the preceding repair's pass. Safari, Chrome and remaining current-head gates remain separate obligations; no overall merge approval is implied.

## 🔎 Identity and integrity

Base `13b74ecea5f2552627ff638be9413ad4754ef581`; tested merge `4be35332dda5e805c7fd8c45d69099b535c3000f`. Independently resolved source and tested trees as `fa97144469a2a600ff304d38c9747af724d71807`. Native run `41903959769`, attempt 1, Firefox job `126833486448`, supplied artifact `13360235377`. Recomputed ZIP SHA-256 `eb3d483da1469782b7f238b3d29f507a7e6cbac040cf0a1a0b26177fdef2663b`. Fresh acceptance/release manifests identify the exact source and tested merge. Firefox 159.0.1, macOS 26.6.2 arm64, image 20261026.0455.2; native permission and notarization observations are retained.

## 🧪 Current handoff and strict deletion

The actual one-tab inventory moves from the initial inert URL to `?phase=uncontrolled`. Handoff reports fresh true, ready complete, inert marker, zero scripts and controller null. The following read-only pre-stop verification independently reports zero registrations and no controller before PID 4161 exits. After same-profile relaunch, inventory still contains only that inert URL and the unchanged strict deletion precondition again reports no registration/controller.

One shell cache is enumerated/deleted; localStorage is cleared and only account database `spinel-offline-26aac723-41fc-46cd-aba8-bde0f6e1d0dc` is targeted. All operations pass within the unchanged 28000-ms operation budget. Final witnesses show cacheNames [], workers [], localStorageEntries 0 and no account database; unrelated Univer/runtime databases remain explicit context. There is no second unregister/deletion or assertion recovery. The app reports account null/available 0 afterward and refuses missing-content opening under the verified outage. Thus both the new live-browser client-release boundary and the original post-loss contract are exercised. The actual execution has one tab; deterministic controls retain responsibility for multi-tab negatives.

## 📝 Content, processes and cleanup

All four original downloads/images survive the first offline restart, and all four native pending edits/checkpoints survive the next. Clipboard and captures show Sheet 731 and Doc “Desktop offline 731 Recovery base notes”. Current source assertions compare complete records, checkpoints, normalized native/server content and image rows. Both normal reconnects reach revision 2 and retain idempotent reopening; both conflict copies preserve original server state and exactly two receipts through another outage/reconnect. Independently hashed every emitted image byte array, checked its image ID, and matched hash/size pairs against that item's retained-image witnesses.

The four browser PIDs 2472, 3443, 4161 and 5767 form the recorded prior-PID chain. All use the same explicit profile path, device 16777227, inode 3036844. All four owned browser/driver exits are witnessed, including final cleanup. Forwarded requests/upgrades remain 252/four during the original offline lifecycle. Two conflict outage snapshots record one tracked socket; raw HTTPS/upgrade refusal and unchanged forwarding assertions remain authoritative, so no claim of zero sockets at every instant is made. Final transport reports zero sockets.

## 🖼️ Images and diagnostic limits

Inspected all nine current screenshots: eight synthetic app captures and the localhost storage-permission prompt. Normal-offline and recovered-copy Sheet/Doc images visibly preserve edited values and colored fixture images. The prompt includes hosted menu/dock/browser chrome and a synthetic item URL, with no credentials or unrelated personal content visible. It documents ordinary permission handling for the owned Firefox PID. Driver logs retain GPU/XPC warnings and software WebRender fallback; actual pixels/native content are demonstrated, without a hardware-GPU claim.

No browser/test workload or source edit was performed during this audit. Operator attribution/cleanup, Owner and Collaborator content/recovery contracts, and unchanged Link guest authority remain consistent with the reviewed scope. This current Firefox pass does not identify Safari's earlier persistence mechanism or waive its pending execution.
