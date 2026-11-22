# 🔎 November 22 recovery attempts

These receipts retain first failures and historical PR #301 metadata before the
new integration. No aborted attempt supplies acceptance. Node 26.13.0, shared
serial runner and 2 GiB process-tree limit.

- Initial focused batch: pressure abort; no test result claimed. Helper source
  was unchanged from 86d5810. The extra authenticationLifecycle path did not exist;
  subsequent selection uses the actual offlineLifecycle owner.
- Separate helper run: 30 passed; runtime helper matches86d5810.
- First production build: pressure abort at b6b6ca4c. Bounded 384MiB heap and one
  Rayon worker then passed on that exact source; flags are in the receipt.
- First menu browser attempt on b6b6ca4c: pressure abort before a finalized
  report. The first watchdog killed its command group but left Playwright’s
  separately grouped server; cwd/PID ownership was verified and the task-owned
  wrapper 42553 was closed gracefully. The local watchdog now tracks descendant
  PIDs too. No original failure was rerun into a pass.
- Typecheck: pressure abort on b6b6ca4c with in-progress test/feedback changes;
  no complete compile result or exact clean-source acceptance claimed.
- Later starts refused by the serial runner while macOS pressure remained 2.

The recovered PR description is immutable historical evidence at 86d5810, with
its own build/check/review identities; it is not acceptance of the new candidate.
