# SPN-131 first final-source attempt: diagnosed EC2 rejection

Source `190a36c3d55712ace86818bc972bafd49954b7cd`, base
`1fca8a98c315d2f715e8051537e50f2efbbe580b`. Ordinary CI run 41470825163,
attempt 1, job 125363957600 failed at mirror validation before browser install.
The full original log and independently reconstructed input are retained. The
input is 152 bytes, SHA-256
`af9816b59bc904eaf28838ae673ac2b625b6628bebfc67a7cbeae78ba06e226a`.
It contains the EC2 us-east-2 archive at priority 1, official HTTPS archive at 2,
and security archive at 3. The existing Azure-only parser recognized only the
official archive and rejected the pair before writing. Header/environment both
report image 20261018.96.1; AWS runner region us-east-1 does not determine the
mirror hostname. No redaction prevents reconstruction of this actual input.

This new evidence superseded the diagnostics-only split. The remaining CI and
Storybook 41470825153 work was deliberately cancelled to repair the source;
neither event was retried and neither supplies passing acceptance. Cancellation
also leaves dependent aggregate failures; these are not separate application
regressions. Both complete paginated job lists and before/terminal run metadata
are retained. A force-cancel follow-up returned 409 because CI had already
completed; it made no further change.

The allocated SPN-136 proposal is preserved verbatim. It had never reached main
and is retired without ID reuse or a completed-ticket claim: next_id stays 137.
The actual repair belongs to original SPN-131 and must receive fresh current-head
checks and hosted installation/smoke proof for the captured EC2 profile. Earlier
uncaptured inputs remain unknown; this does not prove their retrospective cause.

The first local repair test attempt passed 22/22 controls without retry, skip or
host-file mutation. Its log is included; these tests were not in the failed
hosted source. No full browser trace archive is claimed.
