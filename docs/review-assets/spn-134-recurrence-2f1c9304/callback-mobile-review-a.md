# 🔎 Independent retained-trace review A

Reviewer `/root/spn120_review_a`, 2026-11-04, agent review only.
Source `2f1c9304b15adfef833e53f12c4facff9ce14821`, CI41885019303,
mobile callback job126767285654. No implementation or browser execution.

The baseline's raw trace includes input-start102038499, final-key393584560,
disposed407373334 and end408576946 microseconds. Typing lasted291.546s;
disposal/end followed14.992s later. The gzip stream reaches clean EOF with
607927866 uncompressed bytes and999295 lines. This proves readable retained
compressed evidence, not completed attribution or acceptance.

The typing manifest is stale because persistence happens at typing start and
after collection/cleanup. The exact interrupted operation remains unknown.
Missing error/completion fields do not establish browser errors or dropped data.
Candidate success cannot satisfy the failed historical comparison.

Use existing SPN-134: bounded offline read/attribution/finalization diagnosis,
then repair demonstrated observation gaps. No unchanged browser rerun, higher
timeout or comparison waiver is justified by this evidence.
