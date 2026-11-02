# SPN098 current tablet setup failure

Source24e00a783803749b73483457b923dddafee9996c; base3233f9374c9dc028094f548b308a3f9dda3265ca;
tested merge dbbe5ccaf085ce20b79068d3596a35dcf2142223;
source/tested tree45abc48cdb93347a62f514da4773ea7ff5521935.
Storybook41440026548 attempt1, tablet job125260006107.

The strict prefer-ubuntu-archive.ts guard rejected /etc/apt/apt-mirrors.txt:
expected exactly one Azure/archive pair with priorities1and2. Failure occurred
before Chromium installation or any story assertion. Runner identifies
Ubuntu24.04 image20261018.96.1, CloudAWS. Actual mirror contents were not emitted;
cloud identity does not establish their shape or cause. Original complete log
and authoritative terminal job metadata are retained here. No screenshots exist
from this job because browser setup did not complete.

This is the existing SPN131 setup class, which remains independently owned.
Predeclared recovery in PR227 comment6576511733: at most one targeted retry of
this failed job after the original run finishes (plus dependent aggregate if
GitHub requires), same source and no changed checks/timeouts. Other variants'
previous successful executions are not described as reruns. A repeated setup
failure remains a blocker requiringSPN131. This archive precedes any retry and
makes no passing acceptance claim. The final PR record must retain this failure,
retry outcome/attempt and independent current visual approval separately.
