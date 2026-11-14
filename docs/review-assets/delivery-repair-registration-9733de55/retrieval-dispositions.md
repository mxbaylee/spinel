# Evidence retrieval dispositions

The first `gh api` log download refused to emit terminal escape sequences. The
retrieval was repeated with its explicit `--allow-escape-sequences` option, captured
directly into bytes and gzip-compressed without displaying or executing the log.
This was evidence retrieval, not a test or workflow rerun. All eleven successful
job logs are retained. No CI job was retried, cancelled or modified by this archive.

Local review/check reports replace the registration checkout's personal absolute
path with `<local-registration-checkout>` and make temporary receipt links relative.
Their original-byte and stored-byte hashes are both in `local/original-hashes.json`.
The source/review identities, grades, rubric, commands, results and measurements
remain unchanged. Raw hosted API/plan/result/log payloads and artifact ZIP bytes
are retained without that local-path normalization.
