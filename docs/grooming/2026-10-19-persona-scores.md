# Grooming: persona scores, own sync, and a redesign first

Groomed on 2026-10-19 after SPN-046, SPN-040, SPN-041 and SPN-039, at the owner's
request in chat. Every open ticket was rechecked, and each persona's journey was
walked to find gaps.

## Decisions (owner, chat 2026-10-19)

- **Impact is judged per persona.** Each ticket records `impact_operator`,
  `impact_owner`, `impact_collaborator` and `impact_guest` for the personas it
  touches, and its impact is the highest of them. The must-ship flag is gone.
- **Prerequisites inherit their dependents' rank.** A ticket's score is the higher
  of its own points (2–6) and one more than the score of any ticket that depends
  on it, through the whole chain. Working highest-first can no longer skip a
  prerequisite. The score is written into each ticket by `npm run backlog:index`.
- **Spinel replaces Univer collaboration with its own sync.** SPN-014 is split
  into SPN-056 (merging concurrent edits), SPN-057 (the sync server), SPN-058
  (the client and presence) and SPN-059 (moving every document over and
  removing Univer collaboration). The SPN-010 limits experiment and the SPN-013
  editor queue answer questions the rewrite makes moot, so both are retired.
  Offline editing (SPN-053) now waits for SPN-059 so the sync path is built once.
- **SPN-047 is an AI design review, done before the UI tickets.** It reviews
  Storybook against competing products and redesigns the cluttered screens. Every
  ticket that adds or changes a screen depends on it. Its
  old CI design lint moved to SPN-060.
- **UI PRs carry screenshots** in light, dark and phone width, and merge only
  after the owner approves them. Agents start the next ticket while waiting.
- **Spinel moves off Univer Pro** so nothing is watermarked. Slides is dropped,
  because Univer's Slides is a Pro package: SPN-009 is retired and SPN-074 stops
  offering it. SPN-075 replaces the Pro print plugins, and SPN-073's guest print
  builds on it. No new Pro packages.
- **Replacements live in `lib/<name>/`** (sync-transform, sync-server,
  sync-client, print), so each could be published on its own later.
- **The index is one table** of every open ticket in pick order, with its
  tie-break; the Top 5 is gone.
- **The public HTTPS website (SPN-038) comes last**. It is S impact
  and L effort because it needs the owner working alongside an agent, so it can
  never run on its own.

## New tickets from the persona walk

| Persona             | Gap                                                        | Ticket  |
| ------------------- | ---------------------------------------------------------- | ------- |
| Operator            | No way back in if every admin passkey is lost              | SPN-061 |
| Operator            | No patching routine for the host, images and dependencies  | SPN-062 |
| Operator            | One restore drill, never repeated                          | SPN-063 |
| Operator, Owner     | No reactivation or document handover when someone leaves   | SPN-064 |
| Owner               | No copy of a Sheet or Doc                                  | SPN-065 |
| Owner               | Guest links can only be found document by document         | SPN-066 |
| Owner               | No export of everything at once                            | SPN-067 |
| Owner               | No images in Sheets                                        | SPN-068 |
| Collaborator        | Can't create inside a folder shared as editor              | SPN-069 |
| Collaborator        | A lost device waits on the Operator                        | SPN-070 |
| Collaborator        | Shared with me only grows; inherited access is unexplained | SPN-071 |
| Owner, Collaborator | Docs are hard to edit on a phone                           | SPN-072 |
| Link guest          | Can't print or save a PDF                                  | SPN-073 |
| Owner               | Printed pages are watermarked and limited by Univer Pro    | SPN-075 |

Smaller gaps went into existing tickets: an unauthenticated health check and
disk/upload metrics (SPN-032), a hostname change using break-glass access
(SPN-038), the guest page in the new layout (SPN-049), and Collaborators
creating only in their own folders until SPN-069 (SPN-051). Patterns no ticket
owns (the Share dialog, Admin, the guest pages and the revoked-link page) are in
SPN-047's review.

## Coverage after this backlog

With these tickets done, each persona has a complete path. The Operator can
install, monitor, patch, back up, restore and recover access. The Owner can
create, organise, copy, share, export and work offline. A Collaborator can work
in shared folders, manage their own devices and tidy what is shared with them. A
Link guest can view, edit, print and see a clear page when a link is turned off.
